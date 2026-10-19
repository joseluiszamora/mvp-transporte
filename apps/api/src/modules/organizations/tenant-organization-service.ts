import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext, type AccessTarget } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

type RecordStatus = "ACTIVE" | "INACTIVE";

interface CompanyRow extends QueryResultRow {
  id: string;
  legal_name: string;
  trade_name: string | null;
  nit: string | null;
  contact: string | null;
  address: string | null;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

interface BranchRow extends QueryResultRow {
  id: string;
  company_id: string;
  company_name: string;
  code: string;
  name: string;
  address: string | null;
  contact: string | null;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

type CompanyFields = {
  legalName: string;
  tradeName?: string | null;
  nit?: string | null;
  contact?: string | null;
  address?: string | null;
};

type BranchFields = {
  code: string;
  name: string;
  address?: string | null;
  contact?: string | null;
};

const organizationTarget = (organizationId: string): AccessTarget => ({ organizationId });

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  return session.organizationId;
}

function normalizeText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > max || /[\r\n\0]/u.test(normalized)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined, max: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length > max || /[\r\n\0]/u.test(normalized)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return normalized || null;
}

function validateSearch(search: string | undefined): string | undefined {
  const normalized = search?.trim();
  if (normalized && (normalized.length > 160 || /[\0]/u.test(normalized))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return normalized || undefined;
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

async function loadActorForListing(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  permissionCode: string,
): Promise<{ organizationId: string; context: AccessContext }> {
  const organizationId = requireOrganizationId(session);
  const context = await resolveAccessContext(database, session.userId, organizationId);
  if (!context?.grants.some((grant) => grant.permissionCode === permissionCode && grant.organizationId === organizationId)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
  return { organizationId, context };
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

function ensurePermission(context: AccessContext, code: string, target: AccessTarget): void {
  if (!hasPermission(context, code, target)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

function mapCompany(row: CompanyRow): Record<string, unknown> {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    nit: row.nit,
    contact: row.contact,
    address: row.address,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapBranch(row: BranchRow): Record<string, unknown> {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    code: row.code,
    name: row.name,
    address: row.address,
    contact: row.contact,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listTenantCompanies(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number; search?: string; status?: RecordStatus },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { organizationId, context } = await loadActorForListing(database, session, "companies.read");
  const search = validateSearch(input.search);
  const filters = ["company.organization_id = $1::uuid", "($2::\"RecordStatus\" IS NULL OR company.status = $2)", "($3::text IS NULL OR company.legal_name ILIKE '%' || $3 || '%' OR company.trade_name ILIKE '%' || $3 || '%' OR company.nit ILIKE '%' || $3 || '%')"];
  const values = [organizationId, input.status ?? null, search ?? null];
  const candidates = await database.query<{ id: string }>(
    `SELECT company.id FROM companies AS company WHERE ${filters.join(" AND ")} ORDER BY company.legal_name, company.id`,
    values,
  );
  const visibleIds = candidates.rows
    .filter((row) => hasPermission(context, "companies.read", { organizationId, companyId: row.id }))
    .map((row) => row.id);
  if (visibleIds.length === 0) return { items: [], total: 0, limit: input.limit, offset: input.offset };
  const rows = await database.query<CompanyRow>(
    `SELECT company.id, company.legal_name, company.trade_name, company.nit, company.contact,
       company.address, company.status, company.created_at, company.updated_at
     FROM companies AS company
     WHERE company.organization_id = $1::uuid AND company.id = ANY($2::uuid[])
     ORDER BY company.legal_name, company.id LIMIT $3 OFFSET $4`,
    [organizationId, visibleIds, input.limit, input.offset],
  );
  return { items: rows.rows.map(mapCompany), total: visibleIds.length, limit: input.limit, offset: input.offset };
}

export async function createTenantCompany(
  database: Pool,
  session: AuthenticatedSession,
  input: CompanyFields & { requestId: string },
): Promise<Record<string, unknown>> {
  const legalName = normalizeText(input.legalName, 200);
  const tradeName = normalizeOptionalText(input.tradeName, 200) ?? null;
  const nit = normalizeOptionalText(input.nit, 40) ?? null;
  const contact = normalizeOptionalText(input.contact, 300) ?? null;
  const address = normalizeOptionalText(input.address, 500) ?? null;
  const organizationId = requireOrganizationId(session);
  return transaction(database, async (client) => {
    await assertWritableOrganization(client, organizationId);
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    ensurePermission(actor, "companies.create", organizationTarget(organizationId));
    const id = randomUUID();
    const result = await client.query<CompanyRow>(
      `INSERT INTO companies (id, organization_id, legal_name, trade_name, nit, contact, address, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id, legal_name, trade_name, nit, contact, address, status, created_at, updated_at`,
      [id, organizationId, legalName, tradeName, nit, contact, address],
    );
    const row = result.rows[0];
    if (!row) throw new Error("COMPANY_NOT_CREATED");
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId,
      companyId: id,
      action: "COMPANY_CREATED",
      resourceType: "Company",
      resourceId: id,
      requestId: input.requestId,
      after: { legalName, tradeName, nit, contact, address, status: "ACTIVE" },
    });
    return mapCompany(row);
  });
}

export async function updateTenantCompany(
  database: Pool,
  session: AuthenticatedSession,
  input: { companyId: string; requestId: string; status?: RecordStatus } & Partial<CompanyFields>,
): Promise<Record<string, unknown>> {
  const organizationId = requireOrganizationId(session);
  const fields: Array<[keyof CompanyFields, string, number]> = [
    ["legalName", "legal_name", 200], ["tradeName", "trade_name", 200], ["nit", "nit", 40],
    ["contact", "contact", 300], ["address", "address", 500],
  ];
  const normalized = new Map<string, string | null>();
  for (const [key, column, max] of fields) {
    const value = input[key];
    if (value !== undefined) normalized.set(column, key === "legalName" ? normalizeText(value as string, max) : normalizeOptionalText(value, max) ?? null);
  }
  if (!normalized.size && input.status === undefined) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");

  return transaction(database, async (client) => {
    await assertWritableOrganization(client, organizationId);
    const found = await client.query<CompanyRow>(
      `SELECT id, legal_name, trade_name, nit, contact, address, status, created_at, updated_at
       FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      [input.companyId, organizationId],
    );
    const current = found.rows[0];
    if (!current) throw new AuthServiceError(404, "COMPANY_NOT_FOUND", "Empresa no disponible.");
    const target: AccessTarget = { organizationId, companyId: current.id };
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    if (normalized.size) ensurePermission(actor, "companies.update", target);
    if (input.status !== undefined && input.status !== current.status) {
      ensurePermission(actor, input.status === "INACTIVE" ? "companies.deactivate" : "companies.update", target);
    } else if (!normalized.size) {
      ensurePermission(actor, input.status === "INACTIVE" ? "companies.deactivate" : "companies.update", target);
    }
    if (current.status === "INACTIVE" && normalized.size) {
      throw new AuthServiceError(409, "COMPANY_INACTIVE", "La empresa está inactiva; actívala antes de editarla.");
    }
    const next: Record<string, string | null> = {
      legal_name: current.legal_name,
      trade_name: current.trade_name,
      nit: current.nit,
      contact: current.contact,
      address: current.address,
    };
    for (const [column, value] of normalized) next[column] = value;
    const nextStatus = input.status ?? current.status;
    const columns = [...normalized.keys()];
    const parameters: unknown[] = [current.id, organizationId];
    const assignments: string[] = [];
    for (const column of columns) {
      parameters.push(next[column]);
      assignments.push(`${column} = $${parameters.length}`);
    }
    parameters.push(nextStatus);
    assignments.push(`status = $${parameters.length}::"RecordStatus"`, "updated_at = CURRENT_TIMESTAMP");
    const result = await client.query<CompanyRow>(
      `UPDATE companies SET ${assignments.join(", ")}
       WHERE id = $1::uuid AND organization_id = $2::uuid
       RETURNING id, legal_name, trade_name, nit, contact, address, status, created_at, updated_at`,
      parameters,
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("COMPANY_UPDATE_FAILED");
    if (normalized.size || nextStatus !== current.status) {
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId },
        organizationId,
        companyId: current.id,
        action: nextStatus !== current.status
          ? nextStatus === "ACTIVE" ? "COMPANY_ACTIVATED" : "COMPANY_DEACTIVATED"
          : "COMPANY_UPDATED",
        resourceType: "Company",
        resourceId: current.id,
        requestId: input.requestId,
        before: { legalName: current.legal_name, tradeName: current.trade_name, nit: current.nit, contact: current.contact, address: current.address, status: current.status },
        after: { legalName: updated.legal_name, tradeName: updated.trade_name, nit: updated.nit, contact: updated.contact, address: updated.address, status: updated.status },
      });
    }
    return mapCompany(updated);
  });
}

export async function listTenantBranches(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number; companyId?: string; search?: string; status?: RecordStatus },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { organizationId, context } = await loadActorForListing(database, session, "branches.read");
  const search = validateSearch(input.search);
  if (input.companyId) {
    const company = await database.query<{ id: string }>(
      "SELECT id FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid",
      [input.companyId, organizationId],
    );
    if (!company.rows[0]) throw new AuthServiceError(404, "COMPANY_NOT_FOUND", "Empresa no disponible.");
  }
  const filters = ["branch.organization_id = $1::uuid", "($2::uuid IS NULL OR branch.company_id = $2::uuid)", "($3::\"RecordStatus\" IS NULL OR branch.status = $3)", "($4::text IS NULL OR branch.code ILIKE '%' || $4 || '%' OR branch.name ILIKE '%' || $4 || '%' OR company.legal_name ILIKE '%' || $4 || '%')"];
  const values = [organizationId, input.companyId ?? null, input.status ?? null, search ?? null];
  const candidates = await database.query<{ id: string; company_id: string }>(
    `SELECT branch.id, branch.company_id FROM branches AS branch
     JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
     WHERE ${filters.join(" AND ")} ORDER BY company.legal_name, branch.name, branch.id`,
    values,
  );
  const visibleIds = candidates.rows
    .filter((row) => hasPermission(context, "branches.read", { organizationId, companyId: row.company_id, branchId: row.id }))
    .map((row) => row.id);
  if (visibleIds.length === 0) return { items: [], total: 0, limit: input.limit, offset: input.offset };
  const rows = await database.query<BranchRow>(
    `SELECT branch.id, branch.company_id, company.legal_name AS company_name, branch.code,
       branch.name, branch.address, branch.contact, branch.status, branch.created_at, branch.updated_at
     FROM branches AS branch
     JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
     WHERE branch.organization_id = $1::uuid AND branch.id = ANY($2::uuid[])
     ORDER BY company.legal_name, branch.name, branch.id LIMIT $3 OFFSET $4`,
    [organizationId, visibleIds, input.limit, input.offset],
  );
  return { items: rows.rows.map(mapBranch), total: visibleIds.length, limit: input.limit, offset: input.offset };
}

export async function createTenantBranch(
  database: Pool,
  session: AuthenticatedSession,
  input: BranchFields & { companyId: string; requestId: string },
): Promise<Record<string, unknown>> {
  const code = normalizeText(input.code, 40).toLocaleUpperCase("en-US");
  const name = normalizeText(input.name, 160);
  const address = normalizeOptionalText(input.address, 500) ?? null;
  const contact = normalizeOptionalText(input.contact, 300) ?? null;
  const organizationId = requireOrganizationId(session);
  return transaction(database, async (client) => {
    await assertWritableOrganization(client, organizationId);
    const companyResult = await client.query<{ id: string; status: RecordStatus; legal_name: string }>(
      `SELECT id, status, legal_name FROM companies
       WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      [input.companyId, organizationId],
    );
    const company = companyResult.rows[0];
    if (!company) throw new AuthServiceError(404, "COMPANY_NOT_FOUND", "Empresa no disponible.");
    if (company.status !== "ACTIVE") throw new AuthServiceError(409, "COMPANY_INACTIVE", "La empresa está inactiva.");
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    ensurePermission(actor, "branches.create", { organizationId, companyId: company.id });
    const duplicate = await client.query<{ id: string }>(
      "SELECT id FROM branches WHERE company_id = $1::uuid AND upper(code) = $2 LIMIT 1",
      [company.id, code],
    );
    if (duplicate.rows[0]) throw new AuthServiceError(409, "BRANCH_CODE_EXISTS", "El código ya existe en esta empresa.");
    const id = randomUUID();
    const result = await client.query<BranchRow>(
      `INSERT INTO branches (id, organization_id, company_id, code, name, address, contact, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING id, company_id, (SELECT legal_name FROM companies WHERE id = $3::uuid) AS company_name,
         code, name, address, contact, status, created_at, updated_at`,
      [id, organizationId, company.id, code, name, address, contact],
    );
    const row = result.rows[0];
    if (!row) throw new Error("BRANCH_NOT_CREATED");
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, organizationId, companyId: company.id, branchId: id,
      action: "BRANCH_CREATED", resourceType: "Branch", resourceId: id, requestId: input.requestId,
      after: { code, name, address, contact, status: "ACTIVE" },
    });
    return mapBranch(row);
  });
}

export async function updateTenantBranch(
  database: Pool,
  session: AuthenticatedSession,
  input: { branchId: string; requestId: string; status?: RecordStatus } & Partial<BranchFields>,
): Promise<Record<string, unknown>> {
  const organizationId = requireOrganizationId(session);
  const normalized = new Map<string, string | null>();
  if (input.code !== undefined) normalized.set("code", normalizeText(input.code, 40).toLocaleUpperCase("en-US"));
  if (input.name !== undefined) normalized.set("name", normalizeText(input.name, 160));
  if (input.address !== undefined) normalized.set("address", normalizeOptionalText(input.address, 500) ?? null);
  if (input.contact !== undefined) normalized.set("contact", normalizeOptionalText(input.contact, 300) ?? null);
  if (!normalized.size && input.status === undefined) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");

  return transaction(database, async (client) => {
    const initial = await client.query<{ id: string; company_id: string }>(
      "SELECT id, company_id FROM branches WHERE id = $1::uuid AND organization_id = $2::uuid",
      [input.branchId, organizationId],
    );
    const initialBranch = initial.rows[0];
    if (!initialBranch) throw new AuthServiceError(404, "BRANCH_NOT_FOUND", "Sucursal no disponible.");
    const companyResult = await client.query<{ status: RecordStatus }>(
      "SELECT status FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE",
      [initialBranch.company_id, organizationId],
    );
    if (!companyResult.rows[0]) throw new AuthServiceError(404, "BRANCH_NOT_FOUND", "Sucursal no disponible.");
    await assertWritableOrganization(client, organizationId);
    if (companyResult.rows[0].status !== "ACTIVE") throw new AuthServiceError(409, "COMPANY_INACTIVE", "La empresa está inactiva.");
    const found = await client.query<BranchRow>(
      `SELECT branch.id, branch.company_id, company.legal_name AS company_name, branch.code, branch.name,
         branch.address, branch.contact, branch.status, branch.created_at, branch.updated_at
       FROM branches AS branch JOIN companies AS company ON company.id = branch.company_id
       WHERE branch.id = $1::uuid AND branch.organization_id = $2::uuid FOR UPDATE OF branch`,
      [input.branchId, organizationId],
    );
    const current = found.rows[0];
    if (!current) throw new AuthServiceError(404, "BRANCH_NOT_FOUND", "Sucursal no disponible.");
    const target: AccessTarget = { organizationId, companyId: current.company_id, branchId: current.id };
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    if (normalized.size) ensurePermission(actor, "branches.update", target);
    if (input.status !== undefined && input.status !== current.status) {
      ensurePermission(actor, input.status === "INACTIVE" ? "branches.deactivate" : "branches.update", target);
    } else if (!normalized.size) {
      ensurePermission(actor, input.status === "INACTIVE" ? "branches.deactivate" : "branches.update", target);
    }
    if (current.status === "INACTIVE" && normalized.size) {
      throw new AuthServiceError(409, "BRANCH_INACTIVE", "La sucursal está inactiva; actívala antes de editarla.");
    }
    if (normalized.has("code")) {
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM branches WHERE company_id = $1::uuid AND upper(code) = $2 AND id <> $3::uuid LIMIT 1",
        [current.company_id, normalized.get("code"), current.id],
      );
      if (duplicate.rows[0]) throw new AuthServiceError(409, "BRANCH_CODE_EXISTS", "El código ya existe en esta empresa.");
    }
    const columns = [...normalized.keys()];
    const values: unknown[] = [current.id, organizationId];
    const assignments: string[] = [];
    for (const column of columns) {
      values.push(normalized.get(column));
      assignments.push(`${column} = $${values.length}`);
    }
    const nextStatus = input.status ?? current.status;
    values.push(nextStatus);
    assignments.push(`status = $${values.length}::"RecordStatus"`, "updated_at = CURRENT_TIMESTAMP");
    const result = await client.query<BranchRow>(
      `UPDATE branches AS branch SET ${assignments.join(", ")}
       FROM companies AS company
       WHERE branch.id = $1::uuid AND branch.organization_id = $2::uuid AND company.id = branch.company_id
       RETURNING branch.id, branch.company_id, company.legal_name AS company_name, branch.code, branch.name,
         branch.address, branch.contact, branch.status, branch.created_at, branch.updated_at`,
      values,
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("BRANCH_UPDATE_FAILED");
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, organizationId, companyId: current.company_id, branchId: current.id,
      action: nextStatus !== current.status
        ? nextStatus === "ACTIVE" ? "BRANCH_ACTIVATED" : "BRANCH_DEACTIVATED"
        : "BRANCH_UPDATED",
      resourceType: "Branch", resourceId: current.id, requestId: input.requestId,
      before: { code: current.code, name: current.name, address: current.address, contact: current.contact, status: current.status },
      after: { code: updated.code, name: updated.name, address: updated.address, contact: updated.contact, status: updated.status },
    });
    return mapBranch(updated);
  });
}
