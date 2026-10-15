import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext, type AccessTarget } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

export type CatalogScope = "GLOBAL" | "ORGANIZATION" | "COMPANY";
export type CatalogRecordStatus = "ACTIVE" | "INACTIVE";

interface CatalogRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: CatalogScope;
  organization_id: string | null;
  company_id: string | null;
  company_name: string | null;
  status: CatalogRecordStatus;
  is_protected: boolean;
  created_at: Date;
  updated_at: Date;
}

interface CatalogItemRow extends QueryResultRow {
  id: string;
  catalog_id: string;
  code: string;
  name: string;
  description: string | null;
  status: CatalogRecordStatus;
  created_at: Date;
  updated_at: Date;
}

interface CatalogQuery {
  limit: number;
  offset: number;
  search?: string;
  status?: CatalogRecordStatus;
  scope?: CatalogScope;
}

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  return session.organizationId;
}

function normalizeCode(value: string): string {
  const code = value.trim().replace(/\s+/gu, "_").toLocaleUpperCase("en-US");
  if (!code || code.length > 80 || !/^[A-Z0-9][A-Z0-9._-]*$/u.test(code)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "El código no es válido.");
  }
  return code;
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 160 || /[\r\n\0]/u.test(name)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "El nombre no es válido.");
  }
  return name;
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const description = value.trim().replace(/\s+/gu, " ");
  if (description.length > 500 || /[\r\n\0]/u.test(description)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La descripción no es válida.");
  }
  return description || null;
}

function normalizeSearch(value: string | undefined): string | undefined {
  const search = value?.trim();
  if (search && (search.length > 160 || /[\0]/u.test(search))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  }
  return search || undefined;
}

async function transaction<T>(database: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function hasAnyPermission(context: AccessContext, permissionCode: string): boolean {
  return context.grants.some((grant) => grant.permissionCode === permissionCode && grant.organizationId === context.organizationId);
}

function requireAnyPermission(context: AccessContext, permissionCode: string): void {
  if (!hasAnyPermission(context, permissionCode)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

async function loadContext(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  permissionCode: string,
): Promise<{ organizationId: string; context: AccessContext }> {
  const organizationId = requireOrganizationId(session);
  const context = await resolveAccessContext(database, session.userId, organizationId);
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  requireAnyPermission(context, permissionCode);
  return { organizationId, context };
}

function canAccessCatalog(context: AccessContext, catalog: Pick<CatalogRow, "scope" | "organization_id" | "company_id">, permissionCode: string): boolean {
  if (catalog.scope === "GLOBAL") return hasAnyPermission(context, permissionCode);
  if (!catalog.organization_id || catalog.organization_id !== context.organizationId) return false;
  const target: AccessTarget = { organizationId: catalog.organization_id, companyId: catalog.company_id };
  return hasPermission(context, permissionCode, target);
}

function mapCatalog(row: CatalogRow, context?: AccessContext): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    scope: row.scope,
    organizationId: row.organization_id,
    companyId: row.company_id,
    companyName: row.company_name,
    status: row.status,
    protected: row.is_protected,
    canManage: Boolean(context && row.scope !== "GLOBAL" && !row.is_protected && canAccessCatalog(context, row, "catalogs.manage")),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCatalogItem(row: CatalogItemRow): Record<string, unknown> {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function uniqueConflict(error: unknown, code: string, message: string): never | undefined {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    throw new AuthServiceError(409, code, message);
  }
}

async function assertWritableOrganization(client: PoolClient, organizationId: string): Promise<void> {
  const result = await client.query<{ status: string }>(
    "SELECT status FROM organizations WHERE id = $1::uuid FOR SHARE",
    [organizationId],
  );
  if (result.rows[0]?.status !== "ACTIVE") {
    throw new AuthServiceError(409, "ORGANIZATION_INACTIVE", "La organización no admite cambios.");
  }
}

async function loadCatalog(
  database: Pick<Pool, "query">,
  organizationId: string,
  catalogId: string,
): Promise<CatalogRow> {
  const result = await database.query<CatalogRow>(
    `SELECT catalog.id, catalog.code, catalog.name, catalog.description, catalog.scope,
       catalog.organization_id, catalog.company_id, company.legal_name AS company_name,
       catalog.status, catalog.is_protected, catalog.created_at, catalog.updated_at
     FROM catalogs AS catalog
     LEFT JOIN companies AS company ON company.id = catalog.company_id AND company.organization_id = catalog.organization_id
     WHERE catalog.id = $1::uuid AND (catalog.scope = 'GLOBAL' OR catalog.organization_id = $2::uuid)`,
    [catalogId, organizationId],
  );
  const catalog = result.rows[0];
  if (!catalog) throw new AuthServiceError(404, "CATALOG_NOT_FOUND", "Catálogo no disponible.");
  return catalog;
}

async function requireReadableCatalog(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  catalogId: string,
): Promise<{ organizationId: string; context: AccessContext; catalog: CatalogRow }> {
  const { organizationId, context } = await loadContext(database, session, "catalogs.read");
  const catalog = await loadCatalog(database, organizationId, catalogId);
  if (!canAccessCatalog(context, catalog, "catalogs.read")) {
    throw new AuthServiceError(404, "CATALOG_NOT_FOUND", "Catálogo no disponible.");
  }
  return { organizationId, context, catalog };
}

async function requireManageableCatalog(
  client: PoolClient,
  session: AuthenticatedSession,
  organizationId: string,
  catalogId: string,
): Promise<{ context: AccessContext; catalog: CatalogRow }> {
  const context = await resolveAccessContext(client, session.userId, organizationId);
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  requireAnyPermission(context, "catalogs.manage");
  const locked = await client.query<{ id: string }>(
    "SELECT id FROM catalogs WHERE id = $1::uuid AND (scope = 'GLOBAL' OR organization_id = $2::uuid) FOR UPDATE",
    [catalogId, organizationId],
  );
  if (!locked.rows[0]) throw new AuthServiceError(404, "CATALOG_NOT_FOUND", "Catálogo no disponible.");
  const catalog = await loadCatalog(client, organizationId, catalogId);
  if (catalog.scope === "GLOBAL" || catalog.is_protected) {
    throw new AuthServiceError(403, "CATALOG_PROTECTED", "Este catálogo está protegido y no puede modificarse.");
  }
  if (!canAccessCatalog(context, catalog, "catalogs.manage")) {
    throw new AuthServiceError(404, "CATALOG_NOT_FOUND", "Catálogo no disponible.");
  }
  return { context, catalog };
}

function buildVisibility(context: AccessContext, organizationId: string): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [organizationId];
  if (hasAnyPermission(context, "catalogs.read")) clauses.push("catalog.scope = 'GLOBAL'");
  const canReadOrganization = hasPermission(context, "catalogs.read", { organizationId });
  if (canReadOrganization) {
    clauses.push("(catalog.scope = 'ORGANIZATION' AND catalog.organization_id = $1::uuid)");
    clauses.push("(catalog.scope = 'COMPANY' AND catalog.organization_id = $1::uuid)");
  } else {
    const companyIds = [...new Set(context.grants
      .filter((grant) => grant.permissionCode === "catalogs.read" && grant.organizationId === organizationId && grant.scopeType === "COMPANY" && grant.companyId)
      .map((grant) => grant.companyId as string))];
    if (companyIds.length) {
      values.push(companyIds);
      clauses.push(`(catalog.scope = 'COMPANY' AND catalog.organization_id = $1::uuid AND catalog.company_id = ANY($${values.length}::uuid[]))`);
    }
  }
  return { sql: clauses.length ? `(${clauses.join(" OR ")})` : "false", values };
}

export async function listCatalogs(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: CatalogQuery,
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { organizationId, context } = await loadContext(database, session, "catalogs.read");
  const search = normalizeSearch(input.search);
  const visibility = buildVisibility(context, organizationId);
  const filters = [visibility.sql];
  const values = [...visibility.values];
  if (input.scope) {
    values.push(input.scope);
    filters.push(`catalog.scope = $${values.length}::"CatalogScope"`);
  }
  if (input.status) {
    values.push(input.status);
    filters.push(`catalog.status = $${values.length}::"RecordStatus"`);
  }
  if (search) {
    values.push(search);
    filters.push(`(catalog.code ILIKE '%' || $${values.length} || '%' OR catalog.name ILIKE '%' || $${values.length} || '%' OR catalog.description ILIKE '%' || $${values.length} || '%')`);
  }
  const where = filters.join(" AND ");
  const [count, rows] = await Promise.all([
    database.query<{ total: number }>(`SELECT count(*)::int AS total FROM catalogs AS catalog WHERE ${where}`, values),
    database.query<CatalogRow>(
      `SELECT catalog.id, catalog.code, catalog.name, catalog.description, catalog.scope,
         catalog.organization_id, catalog.company_id, company.legal_name AS company_name,
         catalog.status, catalog.is_protected, catalog.created_at, catalog.updated_at
       FROM catalogs AS catalog
       LEFT JOIN companies AS company ON company.id = catalog.company_id AND company.organization_id = catalog.organization_id
       WHERE ${where}
       ORDER BY catalog.scope, catalog.name, catalog.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset],
    ),
  ]);
  return { items: rows.rows.map((row) => mapCatalog(row, context)), total: count.rows[0]?.total ?? 0, limit: input.limit, offset: input.offset };
}

export async function listCatalogScopeOptions(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number },
): Promise<{ organization: boolean; companies: Array<{ id: string; legalName: string }>; totalCompanies: number; limit: number; offset: number }> {
  const { organizationId, context } = await loadContext(database, session, "catalogs.manage");
  const canManageOrganization = hasPermission(context, "catalogs.manage", { organizationId });
  const companyIds = [...new Set(context.grants
    .filter((grant) => grant.permissionCode === "catalogs.manage" && grant.organizationId === organizationId && grant.scopeType === "COMPANY" && grant.companyId)
    .map((grant) => grant.companyId as string))];
  const values: unknown[] = [organizationId];
  const filters = ["company.organization_id = $1::uuid", "company.status = 'ACTIVE'"];
  if (!canManageOrganization) {
    if (!companyIds.length) {
      return { organization: false, companies: [], totalCompanies: 0, limit: input.limit, offset: input.offset };
    }
    values.push(companyIds);
    filters.push(`company.id = ANY($${values.length}::uuid[])`);
  }
  const where = filters.join(" AND ");
  const [count, rows] = await Promise.all([
    database.query<{ total: number }>(`SELECT count(*)::int AS total FROM companies AS company WHERE ${where}`, values),
    database.query<{ id: string; legal_name: string }>(
      `SELECT company.id, company.legal_name FROM companies AS company WHERE ${where}
       ORDER BY company.legal_name, company.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset],
    ),
  ]);
  return {
    organization: canManageOrganization,
    companies: rows.rows.map((row) => ({ id: row.id, legalName: row.legal_name })),
    totalCompanies: count.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function listCatalogItems(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: CatalogQuery & { catalogId: string },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { catalog } = await requireReadableCatalog(database, session, input.catalogId);
  if (catalog.status === "INACTIVE" && input.status === "ACTIVE") {
    return { items: [], total: 0, limit: input.limit, offset: input.offset };
  }
  const search = normalizeSearch(input.search);
  const values: unknown[] = [input.catalogId];
  const filters = ["item.catalog_id = $1::uuid"];
  if (input.status) {
    values.push(input.status);
    filters.push(`item.status = $${values.length}::"RecordStatus"`);
  }
  if (search) {
    values.push(search);
    filters.push(`(item.code ILIKE '%' || $${values.length} || '%' OR item.name ILIKE '%' || $${values.length} || '%' OR item.description ILIKE '%' || $${values.length} || '%')`);
  }
  const where = filters.join(" AND ");
  const [count, rows] = await Promise.all([
    database.query<{ total: number }>(`SELECT count(*)::int AS total FROM catalog_items AS item WHERE ${where}`, values),
    database.query<CatalogItemRow>(
      `SELECT item.id, item.catalog_id, item.code, item.name, item.description, item.status, item.created_at, item.updated_at
       FROM catalog_items AS item WHERE ${where}
       ORDER BY item.name, item.code, item.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset],
    ),
  ]);
  return { items: rows.rows.map(mapCatalogItem), total: count.rows[0]?.total ?? 0, limit: input.limit, offset: input.offset };
}

export async function createCatalog(
  database: Pool,
  session: AuthenticatedSession,
  input: { code: string; name: string; description?: string | null; scope: Exclude<CatalogScope, "GLOBAL">; companyId?: string; requestId: string },
): Promise<Record<string, unknown>> {
  const code = normalizeCode(input.code);
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description) ?? null;
  const organizationId = requireOrganizationId(session);
  try {
    return await transaction(database, async (client) => {
      await assertWritableOrganization(client, organizationId);
      const context = await resolveAccessContext(client, session.userId, organizationId);
      if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
      let target: AccessTarget = { organizationId };
      let companyId: string | null = null;
      let companyName: string | null = null;
      if (input.scope === "ORGANIZATION") {
        if (input.companyId) throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no es válido.");
      } else {
        if (!input.companyId) throw new AuthServiceError(400, "INVALID_REQUEST", "Selecciona una empresa para este catálogo.");
        const companyResult = await client.query<{ id: string; legal_name: string; status: string }>(
          "SELECT id, legal_name, status FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE",
          [input.companyId, organizationId],
        );
        const company = companyResult.rows[0];
        if (!company) throw new AuthServiceError(404, "COMPANY_NOT_FOUND", "Empresa no disponible.");
        if (company.status !== "ACTIVE") throw new AuthServiceError(409, "COMPANY_INACTIVE", "La empresa está inactiva.");
        companyId = company.id;
        companyName = company.legal_name;
        target = { organizationId, companyId };
      }
      if (!hasPermission(context, "catalogs.manage", target)) {
        throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
      }
      const id = randomUUID();
      const result = await client.query<CatalogRow>(
        `INSERT INTO catalogs (id, code, name, description, scope, organization_id, company_id, status, is_protected, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::"CatalogScope", $6::uuid, $7::uuid, 'ACTIVE', false, CURRENT_TIMESTAMP)
         RETURNING id, code, name, description, scope, organization_id, company_id, NULL::text AS company_name,
           status, is_protected, created_at, updated_at`,
        [id, code, name, description, input.scope, organizationId, companyId],
      );
      const catalog = result.rows[0];
      if (!catalog) throw new Error("CATALOG_NOT_CREATED");
      catalog.company_name = companyName;
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId }, organizationId, companyId,
        action: "CATALOG_CREATED", resourceType: "Catalog", resourceId: id, requestId: input.requestId,
        after: { code, name, description, scope: input.scope, companyId, status: "ACTIVE" },
      });
      return mapCatalog(catalog, context);
    });
  } catch (error) {
    uniqueConflict(error, "CATALOG_CODE_EXISTS", "El código ya existe en este alcance.");
    throw error;
  }
}

export async function updateCatalog(
  database: Pool,
  session: AuthenticatedSession,
  input: { catalogId: string; name?: string; description?: string | null; status?: CatalogRecordStatus; requestId: string },
): Promise<Record<string, unknown>> {
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  const description = normalizeDescription(input.description);
  if (name === undefined && description === undefined && input.status === undefined) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  const organizationId = requireOrganizationId(session);
  return transaction(database, async (client) => {
    await assertWritableOrganization(client, organizationId);
    const { context, catalog } = await requireManageableCatalog(client, session, organizationId, input.catalogId);
    if (catalog.status === "INACTIVE" && (name !== undefined || description !== undefined)) {
      throw new AuthServiceError(409, "CATALOG_INACTIVE", "Reactiva el catálogo antes de editar sus datos.");
    }
    const nextName = name ?? catalog.name;
    const nextDescription = description === undefined ? catalog.description : description;
    const nextStatus = input.status ?? catalog.status;
    const result = await client.query<CatalogRow>(
      `UPDATE catalogs SET name = $2, description = $3, status = $4::"RecordStatus", updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid RETURNING id, code, name, description, scope, organization_id, company_id,
         NULL::text AS company_name, status, is_protected, created_at, updated_at`,
      [catalog.id, nextName, nextDescription, nextStatus],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("CATALOG_UPDATE_FAILED");
    if (catalog.company_id) {
      const company = await client.query<{ legal_name: string }>("SELECT legal_name FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid", [catalog.company_id, organizationId]);
      updated.company_name = company.rows[0]?.legal_name ?? null;
    }
    if (nextName !== catalog.name || nextDescription !== catalog.description || nextStatus !== catalog.status) {
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId }, organizationId, companyId: catalog.company_id,
        action: nextStatus !== catalog.status ? nextStatus === "ACTIVE" ? "CATALOG_ACTIVATED" : "CATALOG_DEACTIVATED" : "CATALOG_UPDATED",
        resourceType: "Catalog", resourceId: catalog.id, requestId: input.requestId,
        before: { name: catalog.name, description: catalog.description, status: catalog.status },
        after: { name: updated.name, description: updated.description, status: updated.status },
      });
    }
    return mapCatalog(updated, context);
  });
}

export async function createCatalogItem(
  database: Pool,
  session: AuthenticatedSession,
  input: { catalogId: string; code: string; name: string; description?: string | null; requestId: string },
): Promise<Record<string, unknown>> {
  const code = normalizeCode(input.code);
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description) ?? null;
  const organizationId = requireOrganizationId(session);
  try {
    return await transaction(database, async (client) => {
      await assertWritableOrganization(client, organizationId);
      const { catalog } = await requireManageableCatalog(client, session, organizationId, input.catalogId);
      if (catalog.status !== "ACTIVE") throw new AuthServiceError(409, "CATALOG_INACTIVE", "Reactiva el catálogo antes de agregar opciones.");
      const id = randomUUID();
      const result = await client.query<CatalogItemRow>(
        `INSERT INTO catalog_items (id, catalog_id, code, name, description, status, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
         RETURNING id, catalog_id, code, name, description, status, created_at, updated_at`,
        [id, catalog.id, code, name, description],
      );
      const item = result.rows[0];
      if (!item) throw new Error("CATALOG_ITEM_NOT_CREATED");
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId }, organizationId, companyId: catalog.company_id,
        action: "CATALOG_ITEM_CREATED", resourceType: "CatalogItem", resourceId: id, requestId: input.requestId,
        after: { catalogId: catalog.id, code, name, description, status: "ACTIVE" },
      });
      return mapCatalogItem(item);
    });
  } catch (error) {
    uniqueConflict(error, "CATALOG_ITEM_CODE_EXISTS", "El código ya existe en este catálogo.");
    throw error;
  }
}

export async function updateCatalogItem(
  database: Pool,
  session: AuthenticatedSession,
  input: { catalogId: string; itemId: string; code?: string; name?: string; description?: string | null; status?: CatalogRecordStatus; requestId: string },
): Promise<Record<string, unknown>> {
  const code = input.code === undefined ? undefined : normalizeCode(input.code);
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  const description = normalizeDescription(input.description);
  if (code === undefined && name === undefined && description === undefined && input.status === undefined) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  const organizationId = requireOrganizationId(session);
  try {
    return await transaction(database, async (client) => {
      await assertWritableOrganization(client, organizationId);
      const { catalog } = await requireManageableCatalog(client, session, organizationId, input.catalogId);
      if (catalog.status !== "ACTIVE") throw new AuthServiceError(409, "CATALOG_INACTIVE", "Reactiva el catálogo antes de editar sus opciones.");
      const found = await client.query<CatalogItemRow>(
        `SELECT id, catalog_id, code, name, description, status, created_at, updated_at
         FROM catalog_items WHERE id = $1::uuid AND catalog_id = $2::uuid FOR UPDATE`,
        [input.itemId, catalog.id],
      );
      const current = found.rows[0];
      if (!current) throw new AuthServiceError(404, "CATALOG_ITEM_NOT_FOUND", "Opción de catálogo no disponible.");
      if (current.status === "INACTIVE" && (code !== undefined || name !== undefined || description !== undefined)) {
        throw new AuthServiceError(409, "CATALOG_ITEM_INACTIVE", "Reactiva la opción antes de editar sus datos.");
      }
      const nextCode = code ?? current.code;
      const nextName = name ?? current.name;
      const nextDescription = description === undefined ? current.description : description;
      const nextStatus = input.status ?? current.status;
      const result = await client.query<CatalogItemRow>(
        `UPDATE catalog_items SET code = $3, name = $4, description = $5,
           status = $6::"RecordStatus", updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid AND catalog_id = $2::uuid
         RETURNING id, catalog_id, code, name, description, status, created_at, updated_at`,
        [current.id, catalog.id, nextCode, nextName, nextDescription, nextStatus],
      );
      const updated = result.rows[0];
      if (!updated) throw new Error("CATALOG_ITEM_UPDATE_FAILED");
      if (nextCode !== current.code || nextName !== current.name || nextDescription !== current.description || nextStatus !== current.status) {
        await appendAuditEvent(client, {
          actor: { type: "USER", userId: session.userId }, organizationId, companyId: catalog.company_id,
          action: nextStatus !== current.status ? nextStatus === "ACTIVE" ? "CATALOG_ITEM_ACTIVATED" : "CATALOG_ITEM_DEACTIVATED" : "CATALOG_ITEM_UPDATED",
          resourceType: "CatalogItem", resourceId: current.id, requestId: input.requestId,
          before: { catalogId: catalog.id, code: current.code, name: current.name, description: current.description, status: current.status },
          after: { catalogId: catalog.id, code: updated.code, name: updated.name, description: updated.description, status: updated.status },
        });
      }
      return mapCatalogItem(updated);
    });
  } catch (error) {
    uniqueConflict(error, "CATALOG_ITEM_CODE_EXISTS", "El código ya existe en este catálogo.");
    throw error;
  }
}

export async function deactivateCatalogItem(
  database: Pool,
  session: AuthenticatedSession,
  input: { catalogId: string; itemId: string; requestId: string },
): Promise<void> {
  await updateCatalogItem(database, session, { ...input, status: "INACTIVE" });
}

export async function deactivateCatalog(
  database: Pool,
  session: AuthenticatedSession,
  input: { catalogId: string; requestId: string },
): Promise<void> {
  await updateCatalog(database, session, { ...input, status: "INACTIVE" });
}
