import { createDatabasePool } from "../../database.ts";
import { resolveFileStorageRoot } from "./file-storage.ts";
import { cleanupOrphanedFiles } from "./files-cleanup.ts";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write("DATABASE_URL es obligatoria para limpiar archivos privados.\n");
  process.exitCode = 1;
} else {
  const pool = createDatabasePool(connectionString);
  try {
    const result = await cleanupOrphanedFiles(pool, resolveFileStorageRoot());
    process.stdout.write(`Limpieza de archivos privados completada: ${result.removedRecords} registros, ${result.removedUntrackedFiles} huérfanos y ${result.removedTemporaryFiles} temporales.\n`);
  } catch {
    process.stderr.write("La limpieza de archivos privados falló. Revisa la disponibilidad de la base y el volumen.\n");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
