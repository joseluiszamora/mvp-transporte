import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
try {
  process.loadEnvFile(resolve(repositoryRoot, ".env"));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.TRANSPORT_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
