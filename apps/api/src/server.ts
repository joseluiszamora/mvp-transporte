import { createApplication } from "./app.ts";
import { createDatabase } from "./database.ts";
import { BaseIntegrationClient } from "./modules/integrations/base-client.ts";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

const databaseUrl = requiredEnvironment("TRANSPORT_DATABASE_URL");
const baseApiUrl = requiredEnvironment("MVP_BASE_API_URL");
const integrationKey = requiredEnvironment("MVP_BASE_INTEGRATION_KEY");
const portValue = Number(process.env.TRANSPORT_API_PORT ?? "4100");
if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) throw new Error("TRANSPORT_API_PORT no es válido.");
const webOrigins = (process.env.TRANSPORT_WEB_ORIGINS ?? "http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const database = createDatabase(databaseUrl);
const base = new BaseIntegrationClient(baseApiUrl, integrationKey);

try {
  await base.register();
  const app = createApplication(database, base, { webOrigins });
  const server = app.listen(portValue, () => process.stdout.write(`mvp-transporte API escuchando en puerto ${portValue}\n`));
  const shutdown = () => {
    server.close(() => {
      void database.$disconnect().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  process.stderr.write(`No fue posible iniciar mvp-transporte API: ${error instanceof Error ? error.message : "error desconocido"}\n`);
  await database.$disconnect();
  process.exitCode = 1;
}
