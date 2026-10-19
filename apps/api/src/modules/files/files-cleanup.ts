import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { ensureFileStorageDirectories, getStoredFilePath, orphanGracePeriodMs, removeStoredPath } from "./file-storage.ts";

interface DeletableFileRow extends QueryResultRow {
  id: string;
  organization_id: string;
  company_id: string;
  branch_id: string | null;
  storage_key: string;
}

interface DiskFile {
  storageKey: string;
  path: string;
  modifiedAt: number;
}

const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function inTransaction<T>(database: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const value = await action(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function enumerateStoredFiles(root: string): Promise<DiskFile[]> {
  const files: DiskFile[] = [];
  for (const first of await readdir(root, { withFileTypes: true })) {
    if (!first.isDirectory() || !/^[0-9a-f]{2}$/iu.test(first.name)) continue;
    const firstPath = join(root, first.name);
    for (const second of await readdir(firstPath, { withFileTypes: true })) {
      if (!second.isDirectory() || !/^[0-9a-f]{2}$/iu.test(second.name)) continue;
      const secondPath = join(firstPath, second.name);
      for (const item of await readdir(secondPath, { withFileTypes: true })) {
        if (!item.isFile() || !storageKeyPattern.test(item.name)) continue;
        if (item.name.slice(0, 2).toLocaleLowerCase("en-US") !== first.name.toLocaleLowerCase("en-US") || item.name.slice(2, 4).toLocaleLowerCase("en-US") !== second.name.toLocaleLowerCase("en-US")) continue;
        const path = getStoredFilePath(root, item.name);
        const stat = await lstat(path);
        if (stat.isFile()) files.push({ storageKey: item.name, path, modifiedAt: stat.mtimeMs });
      }
    }
  }
  return files;
}

async function removeExpiredTemporaryFiles(root: string, cutoff: number): Promise<number> {
  const temporaryRoot = join(root, ".tmp");
  let removed = 0;
  for (const entry of await readdir(temporaryRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.tmp$/iu.test(entry.name)) continue;
    const path = join(temporaryRoot, entry.name);
    const stat = await lstat(path);
    if (stat.isFile() && stat.mtimeMs <= cutoff) {
      await removeStoredPath(path);
      removed += 1;
    }
  }
  return removed;
}

async function removeUntrackedFiles(database: Pool, root: string, cutoff: number): Promise<number> {
  const candidates = (await enumerateStoredFiles(root)).filter((file) => file.modifiedAt <= cutoff);
  let removed = 0;
  for (let offset = 0; offset < candidates.length; offset += 200) {
    const batch = candidates.slice(offset, offset + 200);
    const known = await database.query<{ storage_key: string }>(
      "SELECT storage_key FROM files WHERE storage_key = ANY($1::text[])",
      [batch.map((file) => file.storageKey)],
    );
    const knownKeys = new Set(known.rows.map((row) => row.storage_key));
    for (const file of batch) {
      if (!knownKeys.has(file.storageKey)) {
        await removeStoredPath(file.path);
        removed += 1;
      }
    }
  }
  return removed;
}

/** Purges only unlinked, delete-requested files after the grace period, plus stale crash leftovers. */
export async function cleanupOrphanedFiles(
  database: Pool,
  storageRoot: string,
  options: { now?: Date; gracePeriodMs?: number; batchSize?: number } = {},
): Promise<{ removedRecords: number; removedUntrackedFiles: number; removedTemporaryFiles: number }> {
  const now = options.now ?? new Date();
  const gracePeriod = options.gracePeriodMs ?? orphanGracePeriodMs;
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(gracePeriod) || gracePeriod < 0 || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Invalid file cleanup configuration.");
  }
  await ensureFileStorageDirectories(storageRoot);
  const cutoff = new Date(now.getTime() - gracePeriod);
  const removedTemporaryFiles = await removeExpiredTemporaryFiles(storageRoot, cutoff.getTime());
  let removedRecords = 0;

  while (true) {
    const count = await inTransaction(database, async (client) => {
      const result = await client.query<DeletableFileRow>(
        `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key
         FROM files AS file
         WHERE file.status = 'DELETE_PENDING' AND file.delete_requested_at <= $1::timestamptz
           AND NOT EXISTS (SELECT 1 FROM file_links AS link WHERE link.file_id = file.id)
         ORDER BY file.delete_requested_at, file.id
         FOR UPDATE OF file SKIP LOCKED
         LIMIT $2`,
        [cutoff.toISOString(), batchSize],
      );
      for (const file of result.rows) {
        await removeStoredPath(getStoredFilePath(storageRoot, file.storage_key));
        await client.query("UPDATE employees SET photo_file_id = NULL WHERE photo_file_id = $1::uuid", [file.id]);
        await client.query("DELETE FROM employee_documents WHERE file_id = $1::uuid", [file.id]);
        await appendAuditEvent(client, {
          organizationId: file.organization_id, companyId: file.company_id, branchId: file.branch_id,
          actor: { type: "SYSTEM" }, action: "FILE_PURGED", resourceType: "File", resourceId: file.id,
          requestId: `file-cleanup-${randomUUID()}`, before: { status: "DELETE_PENDING" }, after: { purged: true },
        });
        const deleted = await client.query(
          `DELETE FROM files AS file WHERE file.id = $1::uuid AND file.status = 'DELETE_PENDING'
             AND NOT EXISTS (SELECT 1 FROM file_links AS link WHERE link.file_id = file.id)`,
          [file.id],
        );
        if (deleted.rowCount === 1) removedRecords += 1;
      }
      return result.rows.length;
    });
    if (count < batchSize) break;
  }

  const removedUntrackedFiles = await removeUntrackedFiles(database, storageRoot, cutoff.getTime());
  return { removedRecords, removedUntrackedFiles, removedTemporaryFiles };
}
