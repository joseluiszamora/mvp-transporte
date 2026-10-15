import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createDatabasePool } from "../database.ts";
import { AuthServiceError, type AuthSettings } from "../modules/auth/auth-service.ts";
import { bootstrapPlatformAdmin } from "../modules/organizations/platform-service.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("Configura DATABASE_URL antes de ejecutar el bootstrap.");
}

const settings: AuthSettings = {
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET,
  emailPayloadEncryptionKey: process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY,
  publicWebUrl: process.env.PUBLIC_WEB_URL,
  secureCookies: process.env.NODE_ENV === "production",
};

const prompt = createInterface({ input: stdin, output: stdout });
const pool = createDatabasePool(databaseUrl);

try {
  const email = await prompt.question("Correo del administrador inicial: ");
  const displayName = await prompt.question("Nombre visible: ");
  const confirmation = await prompt.question("Escribe CREAR ADMINISTRADOR DE PLATAFORMA para confirmar: ");
  if (confirmation !== "CREAR ADMINISTRADOR DE PLATAFORMA") {
    stdout.write("Bootstrap cancelado; no se hicieron cambios.\n");
    process.exitCode = 1;
  } else {
    await pool.query("SELECT 1");
    const created = await bootstrapPlatformAdmin(pool, settings, {
      email,
      displayName,
      requestId: randomUUID(),
    });
    stdout.write(`Solicitud creada (${created.userId}). El mensaje de activación quedó en la cola de correo.\n`);
  }
} catch (error) {
  if (error instanceof AuthServiceError) {
    stdout.write(`${error.publicMessage}\n`);
  } else {
    stdout.write("No se pudo completar el bootstrap. Revisa la configuración y el estado de la base de datos.\n");
  }
  process.exitCode = 1;
} finally {
  prompt.close();
  await pool.end();
}
