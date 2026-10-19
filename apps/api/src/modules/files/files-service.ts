import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext, type AccessTarget } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";
import { getStoredFilePath, removeStoredPath } from "./file-storage.ts";

export type FileResourceType = "COMPANY_ATTACHMENT" | "BRANCH_ATTACHMENT";
export type FileResourceAction = "read" | "write";

interface ResourceTarget extends AccessTarget {
  resourceType: FileResourceType;
  resourceId: string;
  scopeType: "COMPANY" | "BRANCH";
  organizationStatus: string;
  companyStatus: string;
  branchStatus: string | null;
  label: string;
}

interface ResourceRow extends QueryResultRow {
  resource_type: FileResourceType;
  resource_id: string;
  organization_id: string;
  company_id: string;
  branch_id: string | null;
  organization_status: string;
  company_status: string;
  branch_status: string | null;
  label: string;
}

interface FileRow extends QueryResultRow {
  id: string;
  organization_id: string;
  company_id: string;
  branch_id: string | null;
  storage_key: string;
  original_name: string;
  detected_mime: string;
  bytes: string;
  sha256: string;
  status: "ACTIVE" | "DELETE_PENDING";
  resource_type: FileResourceType;
  resource_id: string;
  created_at: Date;
}

export interface UploadedFileContent {
  tempPath: string;
  originalName: string;
  detectedMime: string;
  bytes: number;
  sha256: string;
}

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId || !session.selectedMembershipId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa para continuar.");
  }
  return session.organizationId;
}

async function loadContext(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, session: AuthenticatedSession): Promise<AccessContext> {
  const organizationId = requireOrganizationId(session);
  const context = await resolveAccessContext(database as Pick<Pool, "query">, session.userId, organizationId);
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar archivos.");
  return context;
}

async function loadResourceTarget(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  organizationId: string,
  resourceType: FileResourceType,
  resourceId: string,
  lock = false,
): Promise<ResourceTarget> {
  if (resourceType === "COMPANY_ATTACHMENT") {
    const result = await database.query<ResourceRow>(
      `SELECT 'COMPANY_ATTACHMENT'::text AS resource_type, company.id AS resource_id,
          organization.id AS organization_id, company.id AS company_id, NULL::uuid AS branch_id,
          organization.status AS organization_status, company.status AS company_status,
          NULL::text AS branch_status, company.legal_name AS label
       FROM companies AS company
       JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE company.id = $1::uuid AND organization.id = $2::uuid
       ${lock ? "FOR SHARE OF organization, company" : ""}`,
      [resourceId, organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthServiceError(404, "FILE_RESOURCE_NOT_FOUND", "El recurso asociado no está disponible.");
    return {
      resourceType, resourceId: row.resource_id, scopeType: "COMPANY", organizationId: row.organization_id,
      companyId: row.company_id, branchId: null, organizationStatus: row.organization_status,
      companyStatus: row.company_status, branchStatus: null, label: row.label,
    };
  }

  if (resourceType === "BRANCH_ATTACHMENT") {
    const result = await database.query<ResourceRow>(
      `SELECT 'BRANCH_ATTACHMENT'::text AS resource_type, branch.id AS resource_id,
          organization.id AS organization_id, company.id AS company_id, branch.id AS branch_id,
          organization.status AS organization_status, company.status AS company_status,
          branch.status AS branch_status, company.legal_name || ' · ' || branch.code || ' · ' || branch.name AS label
       FROM branches AS branch
       JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
       JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE branch.id = $1::uuid AND organization.id = $2::uuid
       ${lock ? "FOR SHARE OF organization, company, branch" : ""}`,
      [resourceId, organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthServiceError(404, "FILE_RESOURCE_NOT_FOUND", "El recurso asociado no está disponible.");
    return {
      resourceType, resourceId: row.resource_id, scopeType: "BRANCH", organizationId: row.organization_id,
      companyId: row.company_id, branchId: row.branch_id, organizationStatus: row.organization_status,
      companyStatus: row.company_status, branchStatus: row.branch_status, label: row.label,
    };
  }

  throw new AuthServiceError(400, "INVALID_FILE_RESOURCE", "El tipo de recurso no está permitido.");
}

function resourceReadPermission(target: ResourceTarget): string {
  return target.scopeType === "COMPANY" ? "companies.read" : "branches.read";
}

function resourceWritePermission(target: ResourceTarget): string {
  return target.scopeType === "COMPANY" ? "companies.update" : "branches.update";
}

function requireFilePermission(context: AccessContext, permission: string, target: ResourceTarget): void {
  if (!hasPermission(context, permission, target)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación en el recurso asociado.");
  }
}

function assertWritableTarget(target: ResourceTarget): void {
  if (target.organizationStatus !== "ACTIVE" || target.companyStatus !== "ACTIVE" || target.branchStatus === "INACTIVE") {
    throw new AuthServiceError(409, "FILE_RESOURCE_INACTIVE", "El recurso inactivo no admite cambios de archivos.");
  }
}

export async function authorizeFileResource(
  database: Pool,
  session: AuthenticatedSession,
  resourceType: FileResourceType,
  resourceId: string,
  action: FileResourceAction,
): Promise<ResourceTarget> {
  const context = await loadContext(database, session);
  const target = await loadResourceTarget(database, requireOrganizationId(session), resourceType, resourceId);
  requireFilePermission(context, action === "read" ? "files.read" : "files.upload", target);
  requireFilePermission(context, action === "read" ? resourceReadPermission(target) : resourceWritePermission(target), target);
  if (action === "write") assertWritableTarget(target);
  return target;
}

function mapFile(row: FileRow) {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    originalName: row.original_name,
    detectedMime: row.detected_mime,
    bytes: Number(row.bytes),
    createdAt: row.created_at.toISOString(),
    downloadUrl: `/files/${encodeURIComponent(row.id)}/content`,
  };
}

export async function listFileScopeOptions(
  database: Pool,
  session: AuthenticatedSession,
  input: { limit: number; offset: number; search?: string },
) {
  const organizationId = requireOrganizationId(session);
  const context = await loadContext(database, session);
  const normalizedSearch = input.search?.trim() || null;
  if (normalizedSearch && (normalizedSearch.length > 120 || /[\0\r\n]/u.test(normalizedSearch))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  }
  const result = await database.query<ResourceRow>(
    `SELECT resource_type, resource_id, organization_id, company_id, branch_id,
        organization_status, company_status, branch_status, label
     FROM (
       SELECT 'COMPANY_ATTACHMENT'::text AS resource_type, company.id AS resource_id,
         organization.id AS organization_id, company.id AS company_id, NULL::uuid AS branch_id,
         organization.status AS organization_status, company.status AS company_status,
         NULL::text AS branch_status, company.legal_name AS label
       FROM companies AS company
       JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE organization.id = $1::uuid AND organization.status = 'ACTIVE' AND company.status = 'ACTIVE'
       UNION ALL
       SELECT 'BRANCH_ATTACHMENT'::text AS resource_type, branch.id AS resource_id,
         organization.id AS organization_id, company.id AS company_id, branch.id AS branch_id,
         organization.status AS organization_status, company.status AS company_status,
         branch.status::text AS branch_status, company.legal_name || ' · ' || branch.code || ' · ' || branch.name AS label
       FROM branches AS branch
       JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
       JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE organization.id = $1::uuid AND organization.status = 'ACTIVE' AND company.status = 'ACTIVE' AND branch.status = 'ACTIVE'
     ) AS scopes
     WHERE ($2::text IS NULL OR strpos(lower(label), lower($2)) > 0)
     ORDER BY label, resource_type, resource_id`,
    [organizationId, normalizedSearch ?? null],
  );
  const items = result.rows.flatMap((row) => {
    const type = row.resource_type;
    if (type !== "COMPANY_ATTACHMENT" && type !== "BRANCH_ATTACHMENT") return [];
    const target: ResourceTarget = {
      resourceType: type,
      resourceId: row.resource_id,
      scopeType: type === "COMPANY_ATTACHMENT" ? "COMPANY" : "BRANCH",
      organizationId: row.organization_id,
      companyId: row.company_id,
      branchId: row.branch_id,
      organizationStatus: row.organization_status,
      companyStatus: row.company_status,
      branchStatus: row.branch_status,
      label: row.label,
    };
    const canRead = hasPermission(context, "files.read", target) && hasPermission(context, resourceReadPermission(target), target);
    const canDownload = hasPermission(context, "files.download", target) && hasPermission(context, resourceReadPermission(target), target);
    const canUpload = hasPermission(context, "files.upload", target) && hasPermission(context, resourceWritePermission(target), target);
    const canDelete = hasPermission(context, "files.delete", target) && hasPermission(context, resourceWritePermission(target), target);
    if (!canRead && !canDownload && !canUpload && !canDelete) return [];
    return [{ resourceType: type, resourceId: row.resource_id, companyId: row.company_id, branchId: row.branch_id, label: row.label, canRead, canDownload, canUpload, canDelete }];
  });
  return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
}

async function inTransaction<T>(database: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function storeUploadedFile(
  database: Pool,
  session: AuthenticatedSession,
  input: { storageRoot: string; resourceType: FileResourceType; resourceId: string; content: UploadedFileContent; requestId: string },
) {
  const id = randomUUID();
  const storageKey = randomUUID();
  const finalPath = getStoredFilePath(input.storageRoot, storageKey);
  await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
  await rename(input.content.tempPath, finalPath);
  try {
    const item = await inTransaction(database, async (client) => {
      const context = await loadContext(client, session);
      const target = await loadResourceTarget(client, requireOrganizationId(session), input.resourceType, input.resourceId, true);
      requireFilePermission(context, "files.upload", target);
      requireFilePermission(context, resourceWritePermission(target), target);
      assertWritableTarget(target);
      const inserted = await client.query<FileRow>(
        `INSERT INTO files (
           id, organization_id, company_id, branch_id, storage_key, original_name, detected_mime,
           bytes, sha256, status, uploaded_by, created_at, updated_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, 'ACTIVE', $10::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, organization_id, company_id, branch_id, storage_key, original_name, detected_mime,
           bytes::text, sha256, status, CURRENT_TIMESTAMP AS created_at,
           $11::text AS resource_type, $12::uuid::text AS resource_id`,
        [id, target.organizationId, target.companyId, target.branchId, storageKey, input.content.originalName,
          input.content.detectedMime, input.content.bytes, input.content.sha256, session.userId, input.resourceType, input.resourceId],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Stored file could not be created.");
      await client.query(
        `INSERT INTO file_links (id, file_id, resource_type, resource_id, created_at)
         VALUES ($1::uuid, $2::uuid, $3::"FileResourceType", $4::uuid, CURRENT_TIMESTAMP)`,
        [randomUUID(), id, input.resourceType, input.resourceId],
      );
      await appendAuditEvent(client, {
        organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
        actor: { type: "USER", userId: session.userId }, action: "FILE_UPLOADED", resourceType: "File", resourceId: id,
        requestId: input.requestId, after: { detectedMime: input.content.detectedMime, bytes: input.content.bytes, resourceType: input.resourceType },
      });
      return mapFile(row);
    });
    return { item };
  } catch (error) {
    await removeStoredPath(finalPath).catch(() => undefined);
    throw error;
  }
}

export async function listFiles(
  database: Pool,
  session: AuthenticatedSession,
  input: { resourceType: FileResourceType; resourceId: string; limit: number; offset: number; search?: string },
) {
  const context = await loadContext(database, session);
  const target = await loadResourceTarget(database, requireOrganizationId(session), input.resourceType, input.resourceId);
  requireFilePermission(context, "files.read", target);
  requireFilePermission(context, resourceReadPermission(target), target);
  const search = input.search?.trim() || null;
  if (search && (search.length > 120 || /[\0\r\n]/u.test(search))) throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  const params = [target.organizationId, input.resourceType, input.resourceId, search];
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM files AS file
     JOIN file_links AS link ON link.file_id = file.id
     WHERE file.organization_id = $1::uuid AND link.resource_type = $2::"FileResourceType"
       AND link.resource_id = $3::uuid AND file.status = 'ACTIVE'
       AND ($4::text IS NULL OR strpos(lower(file.original_name), lower($4)) > 0)`, params,
  );
  const rows = await database.query<FileRow>(
    `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key,
       file.original_name, file.detected_mime, file.bytes::text, file.sha256, file.status,
       link.resource_type, link.resource_id::text, file.created_at
     FROM files AS file JOIN file_links AS link ON link.file_id = file.id
     WHERE file.organization_id = $1::uuid AND link.resource_type = $2::"FileResourceType"
       AND link.resource_id = $3::uuid AND file.status = 'ACTIVE'
       AND ($4::text IS NULL OR strpos(lower(file.original_name), lower($4)) > 0)
     ORDER BY file.created_at DESC, file.id
     LIMIT $5 OFFSET $6`, [...params, input.limit, input.offset],
  );
  return { items: rows.rows.map(mapFile), total: Number(count.rows[0]?.total ?? "0"), limit: input.limit, offset: input.offset };
}

async function loadAuthorizedFile(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  fileId: string,
  filePermission: "files.read" | "files.download" | "files.delete",
  resourceAction: "read" | "write" = "read",
) {
  const organizationId = requireOrganizationId(session);
  const result = await database.query<FileRow>(
    `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key,
        file.original_name, file.detected_mime, file.bytes::text, file.sha256, file.status,
        link.resource_type, link.resource_id::text, file.created_at
     FROM files AS file JOIN file_links AS link ON link.file_id = file.id
     WHERE file.id = $1::uuid AND file.organization_id = $2::uuid AND file.status = 'ACTIVE'`,
    [fileId, organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible.");
  const target = await loadResourceTarget(database, organizationId, row.resource_type, row.resource_id);
  if (target.companyId !== row.company_id || target.branchId !== row.branch_id) {
    throw new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible.");
  }
  const context = await loadContext(database, session);
  requireFilePermission(context, filePermission, target);
  requireFilePermission(context, resourceAction === "read" ? resourceReadPermission(target) : resourceWritePermission(target), target);
  return { row, item: mapFile(row), target };
}

export async function getFileMetadata(database: Pool, session: AuthenticatedSession, fileId: string) {
  const { item } = await loadAuthorizedFile(database, session, fileId, "files.read");
  return { item };
}

export async function getAuthorizedFileContent(database: Pool, session: AuthenticatedSession, fileId: string, storageRoot: string) {
  const { row, item } = await loadAuthorizedFile(database, session, fileId, "files.download");
  return { item, path: getStoredFilePath(storageRoot, row.storage_key) };
}

export async function requestFileDeletion(database: Pool, session: AuthenticatedSession, fileId: string, requestId: string): Promise<void> {
  const { row, target } = await loadAuthorizedFile(database, session, fileId, "files.delete", "write");
  await inTransaction(database, async (client) => {
    const locked = await client.query<FileRow>(
      `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key,
          file.original_name, file.detected_mime, file.bytes::text, file.sha256, file.status,
          link.resource_type, link.resource_id::text, file.created_at
       FROM files AS file JOIN file_links AS link ON link.file_id = file.id
       WHERE file.id = $1::uuid AND file.organization_id = $2::uuid
       FOR UPDATE OF file`,
      [fileId, target.organizationId],
    );
    const current = locked.rows[0];
    if (current?.status !== "ACTIVE") throw new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible.");
    const latestContext = await loadContext(client, session);
    const latestTarget = await loadResourceTarget(client, target.organizationId, current.resource_type, current.resource_id, true);
    if (latestTarget.companyId !== current.company_id || latestTarget.branchId !== current.branch_id) {
      throw new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible.");
    }
    requireFilePermission(latestContext, "files.delete", latestTarget);
    requireFilePermission(latestContext, resourceWritePermission(latestTarget), latestTarget);
    assertWritableTarget(latestTarget);
    await client.query("DELETE FROM file_links WHERE file_id = $1::uuid", [fileId]);
    await client.query("UPDATE files SET status = 'DELETE_PENDING', delete_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", [fileId]);
    await appendAuditEvent(client, {
      organizationId: latestTarget.organizationId, companyId: latestTarget.companyId, branchId: latestTarget.branchId,
      actor: { type: "USER", userId: session.userId }, action: "FILE_DELETE_REQUESTED", resourceType: "File", resourceId: row.id,
      requestId, before: { status: "ACTIVE" }, after: { status: "DELETE_PENDING", graceHours: 24 },
    });
  });
}
