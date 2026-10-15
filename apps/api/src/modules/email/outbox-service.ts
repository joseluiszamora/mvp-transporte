import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { encryptEmailPayload } from "./email-payload-crypto.ts";

type Transaction = Pick<PoolClient, "query">;

export interface EnqueueEmailInput {
  organizationId?: string | null;
  templateCode: string;
  recipient: string;
  deduplicationKey: string;
  payload: Readonly<Record<string, string | number | boolean>>;
}

export interface EnqueueEmailResult {
  id: string;
  inserted: boolean;
}

function requiredText(value: string, name: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength || /[\r\n\0]/u.test(normalized)) {
    throw new Error(`Invalid ${name}.`);
  }
  return normalized;
}

function validateRecipient(value: string): string {
  const recipient = requiredText(value, "email recipient", 320);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(recipient)) {
    throw new Error("Invalid email recipient.");
  }
  return recipient;
}

/** Queues mail inside the caller's transaction; duplicate event keys do not create another message. */
export async function enqueueEmail(
  transaction: Transaction,
  input: EnqueueEmailInput,
  encryptionKey: string,
): Promise<EnqueueEmailResult> {
  const templateCode = requiredText(input.templateCode, "template code", 100);
  if (!/^[a-z][a-z0-9_.-]*$/u.test(templateCode)) {
    throw new Error("Invalid template code.");
  }
  const recipient = validateRecipient(input.recipient);
  const deduplicationKey = requiredText(input.deduplicationKey, "deduplication key", 200);
  const payloadEntries = Object.entries(input.payload);
  if (payloadEntries.length > 50) {
    throw new Error("Email payload contains too many fields.");
  }
  for (const [key, value] of payloadEntries) {
    requiredText(key, "payload key", 80);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("Email payload fields must be strings, numbers, or booleans.");
    }
    if (typeof value === "string" && value.length > 4_000) {
      throw new Error("Email payload field exceeds the maximum size.");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Email payload contains a non-finite number.");
    }
  }

  const encryptedPayload = encryptEmailPayload(input.payload, encryptionKey);
  const inserted = await transaction.query<{ id: string }>(
    `INSERT INTO email_outbox (
       id, organization_id, template_code, recipient, payload, deduplication_key
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)
     ON CONFLICT (deduplication_key) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.organizationId ?? null,
      templateCode,
      recipient,
      JSON.stringify(encryptedPayload),
      deduplicationKey,
    ],
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, inserted: true };
  }
  const existing = await transaction.query<{ id: string }>(
    "SELECT id FROM email_outbox WHERE deduplication_key = $1",
    [deduplicationKey],
  );
  if (!existing.rows[0]) {
    throw new Error("Email deduplication record could not be resolved.");
  }
  return { id: existing.rows[0].id, inserted: false };
}
