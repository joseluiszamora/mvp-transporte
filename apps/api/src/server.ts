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
  .filter(Boolean)
  .map((origin) => {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error("WEB_ORIGINS debe contener orígenes HTTP(S) absolutos.");
    }
    if (
      !["http:", "https:"].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin ||
      parsedOrigin.username.length > 0 ||
      parsedOrigin.password.length > 0
    ) {
      throw new Error("WEB_ORIGINS debe contener orígenes HTTP(S) exactos, sin comodines ni rutas.");
    }
    return origin;
  });
const pool = connectionString ? createDatabasePool(connectionString) : undefined;
const app = createApp({
  allowedOrigins,
  database: pool,
  authSettings: {
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET,
    emailPayloadEncryptionKey: process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY,
    publicWebUrl: process.env.PUBLIC_WEB_URL,
    secureCookies: process.env.NODE_ENV === "production",
  },
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
