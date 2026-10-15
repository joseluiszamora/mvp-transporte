import { createApp } from "./app.ts";
import { createDatabasePool } from "./database.ts";

function getPort(): number {
  const rawPort = process.env.API_PORT ?? "4000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT debe ser un puerto válido.");
  }
  return port;
}

const connectionString = process.env.DATABASE_URL?.trim();
const host = process.env.API_HOST?.trim() || "127.0.0.1";
const port = getPort();
const allowedOrigins = (process.env.WEB_ORIGINS ?? "http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const pool = connectionString ? createDatabasePool(connectionString) : undefined;
const app = createApp({
  allowedOrigins,
  checkDatabase: async () => {
    if (!pool) {
      throw new Error("DATABASE_URL no está configurada.");
    }
    await pool.query("SELECT 1");
  },
});

const server = app.listen(port, host, () => {
  process.stdout.write(`API disponible en http://${host}:${port}/api/v1/health\n`);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  process.stdout.write(`Cerrando API (${signal}).\n`);
  server.close(async (error) => {
    await pool?.end();
    if (error) {
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
