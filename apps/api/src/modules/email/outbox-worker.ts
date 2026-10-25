import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { decryptEmailPayload } from "./email-payload-crypto.ts";
import type { EmailSender, RenderedEmail } from "./smtp-transport.ts";

interface ClaimedEmail {
  id: string;
  template_code: string;
  recipient: string;
  payload: unknown;
  attempts: number;
  lock_token: string;
}

interface EmailTemplateRow {
  subject: string;
  text_body: string;
  variables: string[];
}

export interface OutboxWorkerOptions {
  encryptionKey: string;
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaximumMs?: number;
  now?: () => number;
  random?: () => number;
}

export interface OutboxBatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; responseCode?: unknown };
    if (typeof record.responseCode === "number" && Number.isInteger(record.responseCode)) {
      return `SMTP_${record.responseCode}`.slice(0, 80);
    }
    if (typeof record.code === "string" && /^[A-Z0-9_]{2,80}$/u.test(record.code)) {
      return record.code;
    }
  }
  return "DELIVERY_FAILED";
}

function cleanPlaceholder(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("TEMPLATE_VARIABLE_INVALID");
  }
  return String(value).replace(/\p{Cc}/gu, " ").slice(0, 4_000);
}

function renderTemplate(template: EmailTemplateRow, payload: Record<string, unknown>): Pick<RenderedEmail, "subject" | "text"> {
  const allowed = new Set(template.variables);
  const keys = Object.keys(payload);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error("TEMPLATE_VARIABLE_INVALID");
  }
  for (const variable of template.variables) {
    if (!Object.hasOwn(payload, variable)) {
      throw new Error("TEMPLATE_VARIABLE_MISSING");
    }
  }

  const interpolate = (value: string): string =>
    value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_placeholder, name: string) => {
      if (!allowed.has(name) || !Object.hasOwn(payload, name)) {
        throw new Error("TEMPLATE_VARIABLE_INVALID");
      }
      return cleanPlaceholder(payload[name]);
    });

  const subject = interpolate(template.subject);
  const text = interpolate(template.text_body);
  if (/[\r\n\0]/u.test(subject) || subject.length === 0 || subject.length > 200 || text.length > 16_384) {
    throw new Error("TEMPLATE_CONTENT_INVALID");
  }
  return { subject, text };
}

async function loadMessage(
  database: Pool,
  email: ClaimedEmail,
  encryptionKey: string,
): Promise<RenderedEmail> {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email.recipient)) {
    throw new Error("RECIPIENT_INVALID");
  }
  const templateResult = await database.query<EmailTemplateRow>(
    "SELECT subject, text_body, variables FROM email_templates WHERE code = $1 AND status = 'ACTIVE'",
    [email.template_code],
  );
  const template = templateResult.rows[0];
  if (!template) {
    throw new Error("TEMPLATE_UNAVAILABLE");
  }
  const payload = decryptEmailPayload(email.payload, encryptionKey);
  return { to: email.recipient, ...renderTemplate(template, payload) };
}

async function claimBatch(
  database: Pool,
  options: Required<Pick<OutboxWorkerOptions, "batchSize" | "maxAttempts" | "leaseMs">>,
): Promise<ClaimedEmail[]> {
  const result = await database.query<ClaimedEmail>(
    `WITH candidates AS (
       SELECT id
       FROM email_outbox
       WHERE attempts < $1
         AND (
           (status IN ('PENDING', 'FAILED') AND next_attempt_at <= CURRENT_TIMESTAMP)
           OR (status = 'PROCESSING' AND locked_at < CURRENT_TIMESTAMP - ($2::double precision * INTERVAL '1 millisecond'))
         )
       ORDER BY next_attempt_at, created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox AS outbox
     SET status = 'PROCESSING',
         attempts = outbox.attempts + 1,
         locked_at = CURRENT_TIMESTAMP,
         lock_token = gen_random_uuid(),
         last_error_code = NULL
     FROM candidates
     WHERE outbox.id = candidates.id
     RETURNING outbox.id, outbox.template_code, outbox.recipient, outbox.payload,
       outbox.attempts, outbox.lock_token`,
    [options.maxAttempts, options.leaseMs, options.batchSize],
  );
  return result.rows;
}

async function finalizeExhaustedLeases(database: Pool, maxAttempts: number, leaseMs: number): Promise<number> {
  const result = await database.query(
    `WITH expired AS (
       SELECT id, attempts
       FROM email_outbox
       WHERE status = 'PROCESSING'
         AND attempts >= $1
         AND locked_at < CURRENT_TIMESTAMP - ($2::double precision * INTERVAL '1 millisecond')
       FOR UPDATE SKIP LOCKED
     ), finalized AS (
       UPDATE email_outbox AS outbox
       SET status = 'FAILED', locked_at = NULL, lock_token = NULL,
           last_error_code = 'DELIVERY_OUTCOME_UNKNOWN'
       FROM expired
       WHERE outbox.id = expired.id
       RETURNING outbox.id, expired.attempts
     )
     INSERT INTO email_deliveries (id, outbox_id, attempt, outcome, error_code)
     SELECT gen_random_uuid(), id, attempts, 'FAILED', 'DELIVERY_OUTCOME_UNKNOWN'
     FROM finalized
     RETURNING outbox_id`,
    [maxAttempts, leaseMs],
  );
  return result.rowCount ?? 0;
}

async function recordSent(database: Pool, email: ClaimedEmail): Promise<boolean> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE email_outbox
       SET status = 'SENT', locked_at = NULL, lock_token = NULL, last_error_code = NULL
       WHERE id = $1::uuid AND status = 'PROCESSING' AND lock_token = $2::uuid
       RETURNING id`,
      [email.id, email.lock_token],
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO email_deliveries (id, outbox_id, attempt, outcome, error_code)
       VALUES ($1::uuid, $2::uuid, $3, 'SENT', NULL)`,
      [randomUUID(), email.id, email.attempts],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordFailure(
  database: Pool,
  email: ClaimedEmail,
  errorCode: string,
  nextAttemptAt: Date,
): Promise<boolean> {
  const client: PoolClient = await database.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE email_outbox
       SET status = 'FAILED', locked_at = NULL, lock_token = NULL,
           last_error_code = $3, next_attempt_at = $4::timestamptz
       WHERE id = $1::uuid AND status = 'PROCESSING' AND lock_token = $2::uuid
       RETURNING id`,
      [email.id, email.lock_token, errorCode, nextAttemptAt],
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO email_deliveries (id, outbox_id, attempt, outcome, error_code)
       VALUES ($1::uuid, $2::uuid, $3, 'FAILED', $4)`,
      [randomUUID(), email.id, email.attempts, errorCode],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function retryDelay(email: ClaimedEmail, options: OutboxWorkerOptions): number {
  const base = options.retryBaseMs ?? 30_000;
  const maximum = options.retryMaximumMs ?? 3_600_000;
  if (!Number.isInteger(base) || base < 1 || !Number.isInteger(maximum) || maximum < 1) {
    throw new Error("Retry delays must be positive integer milliseconds.");
  }
  const random = Math.min(1, Math.max(0, (options.random ?? Math.random)()));
  const exponential = Math.min(maximum, base * 2 ** Math.max(0, email.attempts - 1));
  return Math.min(maximum, Math.round(exponential * (0.75 + random * 0.5)));
}

/** Claims messages without holding locks while SMTP is used; a crashed claim is recovered after its lease. */
export async function processOutboxBatch(
  database: Pool,
  sender: EmailSender,
  options: OutboxWorkerOptions,
): Promise<OutboxBatchResult> {
  const maxAttempts = options.maxAttempts ?? 5;
  const batchSize = options.batchSize ?? 1;
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("maxAttempts must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error("batchSize must be an integer between 1 and 25.");
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 900_000) {
    throw new Error("leaseMs must be an integer between 1000 and 900000.");
  }
  const retryBaseMs = options.retryBaseMs ?? 30_000;
  const retryMaximumMs = options.retryMaximumMs ?? 3_600_000;
  if (
    !Number.isInteger(retryBaseMs) ||
    retryBaseMs < 1 ||
    !Number.isInteger(retryMaximumMs) ||
    retryMaximumMs < 1
  ) {
    throw new Error("Retry delays must be positive integer milliseconds.");
  }

  const finalizedLeases = await finalizeExhaustedLeases(database, maxAttempts, leaseMs);
  const claimed = await claimBatch(database, { batchSize, maxAttempts, leaseMs });
  const summary: OutboxBatchResult = { claimed: claimed.length + finalizedLeases, sent: 0, failed: finalizedLeases };
  for (const email of claimed) {
    try {
      const message = await loadMessage(database, email, options.encryptionKey);
      await sender.send(message);
      if (await recordSent(database, email)) {
        summary.sent += 1;
      }
    } catch (error) {
      const now = (options.now ?? Date.now)();
      const nextAttemptAt = new Date(now + retryDelay(email, options));
      if (await recordFailure(database, email, safeErrorCode(error), nextAttemptAt)) {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
