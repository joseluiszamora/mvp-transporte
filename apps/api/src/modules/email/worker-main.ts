import { createDatabasePool } from "../../database.ts";
import { processOutboxBatch } from "./outbox-worker.ts";
import { createSmtpEmailSender } from "./smtp-transport.ts";

function requiredSetting(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required to run the email worker.`);
  }
  return normalized;
}

function readInteger(value: string | undefined, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return parsed;
}

const databaseUrl = requiredSetting(process.env.DATABASE_URL, "DATABASE_URL");
const encryptionKey = requiredSetting(process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY, "EMAIL_PAYLOAD_ENCRYPTION_KEY");
const pollIntervalMs = readInteger(process.env.EMAIL_WORKER_POLL_MS, "EMAIL_WORKER_POLL_MS", 1_000, 100, 60_000);
const database = createDatabasePool(databaseUrl);
const sender = createSmtpEmailSender();
let stopping = false;

process.stdout.write("Worker de correo iniciado.\n");

function requestShutdown(signal: NodeJS.Signals): void {
  process.stdout.write(`Worker de correo cerrando (${signal}).\n`);
  stopping = true;
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  while (!stopping) {
    try {
      const result = await processOutboxBatch(database, sender, { encryptionKey });
      if (result.claimed === 0) {
        await delay(pollIntervalMs);
      }
    } catch {
      process.stderr.write("Falló un ciclo del worker de correo; se reintentará.\n");
      await delay(pollIntervalMs);
    }
  }
} finally {
  sender.close();
  await database.end();
}
