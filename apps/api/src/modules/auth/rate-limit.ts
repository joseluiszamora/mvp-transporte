import type { Pool } from "pg";
import { createRateLimitKey } from "./auth-crypto.ts";

interface RateLimitRow {
  attempts: number;
  window_started_at: Date;
}

export interface RateLimitInput {
  database: Pick<Pool, "query">;
  operation: string;
  identity: string;
  clientAddress: string;
  maximumAttempts: number;
  windowMs: number;
  now?: Date;
}

/** Persists privacy-preserving counters so limits work across API restarts and instances. */
export async function consumeRateLimit(input: RateLimitInput): Promise<number | null> {
  const keys = [
    createRateLimitKey(`${input.operation}:ip:${input.clientAddress}`),
    createRateLimitKey(`${input.operation}:identity:${input.identity}`),
  ];
  let retryAfterSeconds = 0;
  for (const keyHash of keys) {
    const result = await input.database.query<RateLimitRow>(
      `INSERT INTO auth_rate_limits (key_hash, window_started_at, attempts)
       VALUES ($1, COALESCE($2::timestamptz, CURRENT_TIMESTAMP), 1)
       ON CONFLICT (key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at <= COALESCE($2::timestamptz, CURRENT_TIMESTAMP)
             - ($3::double precision * INTERVAL '1 millisecond')
           THEN COALESCE($2::timestamptz, CURRENT_TIMESTAMP)
           ELSE auth_rate_limits.window_started_at
         END,
         attempts = CASE
           WHEN auth_rate_limits.window_started_at <= COALESCE($2::timestamptz, CURRENT_TIMESTAMP)
             - ($3::double precision * INTERVAL '1 millisecond')
           THEN 1
           ELSE auth_rate_limits.attempts + 1
         END
       RETURNING attempts, window_started_at`,
      [keyHash, input.now ?? null, input.windowMs],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("RATE_LIMIT_COUNTER_UNAVAILABLE");
    }
    if (row.attempts > input.maximumAttempts) {
      const endsAt = row.window_started_at.getTime() + input.windowMs;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((endsAt - (input.now?.getTime() ?? Date.now())) / 1_000));
    }
  }
  if (Math.random() < 0.02) {
    await input.database.query(
      "DELETE FROM auth_rate_limits WHERE window_started_at < CURRENT_TIMESTAMP - INTERVAL '2 days'",
    );
  }
  return retryAfterSeconds > 0 ? retryAfterSeconds : null;
}
