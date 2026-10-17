import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext, type ScopeType } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

export type SettingScope = "INSTALLATION" | "ORGANIZATION" | "COMPANY" | "BRANCH";
export type SettingKey = "locale" | "currency" | "timeZone" | "identity.name" | "identity.logoUrl" | "identity.brandColor";
export type BusinessHourInterval = { start: string; end: string };

export interface ScopeTarget {
  scopeType: Exclude<SettingScope, "INSTALLATION">;
  organizationId: string;
  companyId: string | null;
  branchId: string | null;
  organizationStatus: string;
  companyStatus: string | null;
  branchStatus: string | null;
  companyName: string | null;
}

interface SettingRow extends QueryResultRow {
  id: string;
  scope_type: SettingScope;
  organization_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  key: SettingKey;
  value_type: "STRING";
  value: unknown;
  updated_at: Date;
}

interface BusinessHourRow extends QueryResultRow {
  weekday: number;
  intervals: BusinessHourInterval[];
  scope_type: "COMPANY" | "BRANCH";
  updated_at: Date;
}

interface NumberSequenceRow extends QueryResultRow {
  id: string;
  scope_type: ScopeType;
  organization_id: string;
  company_id: string | null;
  branch_id: string | null;
  document_type: string;
  period: string;
  prefix: string;
  padding: number;
  next_value: string;
  updated_at: Date;
}

interface PageQuery {
  limit: number;
  offset: number;
  search?: string;
}

interface SettingMutation {
  scopeType: Exclude<SettingScope, "INSTALLATION">;
  companyId?: string;
  branchId?: string;
  key: string;
  value: unknown;
  requestId: string;
}

const settingScopes: Record<SettingKey, readonly SettingScope[]> = {
  locale: ["INSTALLATION", "ORGANIZATION", "COMPANY", "BRANCH"],
  currency: ["INSTALLATION", "ORGANIZATION", "COMPANY", "BRANCH"],
  timeZone: ["INSTALLATION", "ORGANIZATION", "COMPANY", "BRANCH"],
  "identity.name": ["COMPANY"],
  "identity.logoUrl": ["COMPANY"],
  "identity.brandColor": ["COMPANY"],
};

const settingKeys = Object.keys(settingScopes) as SettingKey[];

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId || !session.selectedMembershipId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  return session.organizationId;
}

function normalizeSearch(value: string | undefined): string | undefined {
  const search = value?.trim();
  if (search && (search.length > 120 || /[\0\r\n]/u.test(search))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  }
  return search || undefined;
}

function requireKey(value: string): SettingKey {
  if (settingKeys.includes(value as SettingKey)) return value as SettingKey;
  throw new AuthServiceError(400, "INVALID_SETTING_KEY", "La clave de configuración no está permitida.");
}

function validateSettingValue(key: SettingKey, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "El valor de configuración no es válido.");
  }
  const normalized = value.trim();
  switch (key) {
    case "locale":
      if (normalized !== "es") throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "El idioma permitido es español.");
      return normalized;
    case "currency":
      if (normalized !== "BOB") throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "La moneda permitida es BOB.");
      return normalized;
    case "timeZone":
      if (normalized !== "America/La_Paz") throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "La zona horaria permitida es America/La_Paz.");
      return normalized;
    case "identity.name":
      if (!normalized || normalized.length > 160 || /[\r\n\0]/u.test(normalized)) {
        throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "El nombre debe tener entre 1 y 160 caracteres.");
      }
      return normalized;
    case "identity.logoUrl": {
      if (normalized.length > 500) throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "La dirección del logotipo no es válida.");
      let url: URL;
      try { url = new URL(normalized); } catch { throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "La dirección del logotipo no es válida."); }
      const host = url.hostname.toLocaleLowerCase("en-US");
      if (
        url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
      ) {
        throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "El logotipo debe usar una dirección HTTPS pública sin credenciales ni parámetros.");
      }
      return url.toString();
    }
    case "identity.brandColor":
      if (!/^#[0-9a-f]{6}$/iu.test(normalized)) throw new AuthServiceError(400, "INVALID_SETTING_VALUE", "El color debe ser hexadecimal de seis dígitos.");
      return normalized.toUpperCase();
  }
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

function hasAnyPermission(context: AccessContext, permissionCode: string): boolean {
  return context.grants.some((grant) => grant.organizationId === context.organizationId && grant.permissionCode === permissionCode);
}

function requireAnyPermission(context: AccessContext, permissionCode: string): void {
  if (!hasAnyPermission(context, permissionCode)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

async function loadContext(database: Pick<Pool, "query">, session: AuthenticatedSession, permissionCode: string): Promise<AccessContext> {
  const organizationId = requireOrganizationId(session);
  const context = await resolveAccessContext(database, session.userId, organizationId);
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  requireAnyPermission(context, permissionCode);
  return context;
}

export async function loadScopeTarget(
  database: Pick<Pool, "query">,
  organizationId: string,
  companyId?: string,
  branchId?: string,
): Promise<ScopeTarget> {
  if (branchId && !companyId) throw new AuthServiceError(400, "INVALID_REQUEST", "La sucursal requiere una empresa.");
  if (branchId) {
    const result = await database.query<{
      organization_id: string; organization_status: string; company_id: string; company_status: string;
      company_name: string; branch_id: string; branch_status: string;
    }>(
      `SELECT organization.id AS organization_id, organization.status AS organization_status,
         company.id AS company_id, company.status AS company_status, company.legal_name AS company_name,
         branch.id AS branch_id, branch.status AS branch_status
       FROM branches AS branch
       JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
       JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE branch.id = $1::uuid AND company.id = $2::uuid AND organization.id = $3::uuid`,
      [branchId, companyId, organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
    return { scopeType: "BRANCH", organizationId: row.organization_id, companyId: row.company_id, branchId: row.branch_id, organizationStatus: row.organization_status, companyStatus: row.company_status, branchStatus: row.branch_status, companyName: row.company_name };
  }
  if (companyId) {
    const result = await database.query<{ organization_id: string; organization_status: string; company_id: string; company_status: string; company_name: string }>(
      `SELECT organization.id AS organization_id, organization.status AS organization_status,
         company.id AS company_id, company.status AS company_status, company.legal_name AS company_name
       FROM companies AS company JOIN organizations AS organization ON organization.id = company.organization_id
       WHERE company.id = $1::uuid AND organization.id = $2::uuid`,
      [companyId, organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
    return { scopeType: "COMPANY", organizationId: row.organization_id, companyId: row.company_id, branchId: null, organizationStatus: row.organization_status, companyStatus: row.company_status, branchStatus: null, companyName: row.company_name };
  }
  const result = await database.query<{ id: string; status: string }>("SELECT id, status FROM organizations WHERE id = $1::uuid", [organizationId]);
  const organization = result.rows[0];
  if (!organization) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
  return { scopeType: "ORGANIZATION", organizationId: organization.id, companyId: null, branchId: null, organizationStatus: organization.status, companyStatus: null, branchStatus: null, companyName: null };
}

function accessTarget(target: ScopeTarget) {
  return { organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId };
}

function requireTargetPermission(context: AccessContext, permissionCode: string, target: ScopeTarget): void {
  if (!hasPermission(context, permissionCode, accessTarget(target))) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar o modificar este alcance.");
  }
}

function assertTargetWritable(target: ScopeTarget): void {
  if (target.organizationStatus !== "ACTIVE" || target.companyStatus === "INACTIVE" || target.branchStatus === "INACTIVE") {
    throw new AuthServiceError(409, "CONFIGURATION_TARGET_INACTIVE", "El recurso inactivo no admite cambios.");
  }
}

async function lockWritableTarget(client: PoolClient, target: ScopeTarget): Promise<void> {
  const organization = await client.query<{ status: string }>("SELECT status FROM organizations WHERE id = $1::uuid FOR SHARE", [target.organizationId]);
  if (!organization.rows[0]) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
  let companyStatus: string | null = null;
  let branchStatus: string | null = null;
  if (target.companyId) {
    const company = await client.query<{ status: string }>(
      "SELECT status FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE",
      [target.companyId, target.organizationId],
    );
    if (!company.rows[0]) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
    companyStatus = company.rows[0].status;
  }
  if (target.branchId && target.companyId) {
    const branch = await client.query<{ status: string }>(
      "SELECT status FROM branches WHERE id = $1::uuid AND company_id = $2::uuid AND organization_id = $3::uuid FOR SHARE",
      [target.branchId, target.companyId, target.organizationId],
    );
    if (!branch.rows[0]) throw new AuthServiceError(404, "CONFIGURATION_TARGET_NOT_FOUND", "El recurso de configuración no está disponible.");
    branchStatus = branch.rows[0].status;
  }
  assertTargetWritable({ ...target, organizationStatus: organization.rows[0].status, companyStatus, branchStatus });
}

function settingScopeValues(target: ScopeTarget | null): { scopeType: SettingScope; organizationId: string | null; companyId: string | null; branchId: string | null } {
  return target ? {
    scopeType: target.scopeType,
    organizationId: target.organizationId,
    companyId: target.companyId,
    branchId: target.branchId,
  } : { scopeType: "INSTALLATION", organizationId: null, companyId: null, branchId: null };
}

function mapSetting(row: SettingRow) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    organizationId: row.organization_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    key: row.key,
    valueType: row.value_type,
    value: row.value,
    updatedAt: row.updated_at.toISOString(),
  };
}

function scopeFilter(target: ScopeTarget): { where: string; values: unknown[] } {
  if (target.scopeType === "BRANCH") return { where: `scope_type = 'BRANCH' AND organization_id = $1::uuid AND company_id = $2::uuid AND branch_id = $3::uuid`, values: [target.organizationId, target.companyId, target.branchId] };
  if (target.scopeType === "COMPANY") return { where: `scope_type = 'COMPANY' AND organization_id = $1::uuid AND company_id = $2::uuid`, values: [target.organizationId, target.companyId] };
  return { where: `scope_type = 'ORGANIZATION' AND organization_id = $1::uuid AND company_id IS NULL AND branch_id IS NULL`, values: [target.organizationId] };
}

export async function listScopeOptions(
  database: Pool,
  session: AuthenticatedSession,
  input: PageQuery & { companyId?: string; search?: string },
) {
  const context = await loadContext(database, session, "settings.read");
  const search = normalizeSearch(input.search);
  const companyResult = await database.query<{ id: string; legal_name: string }>(
    `SELECT id, legal_name FROM companies WHERE organization_id = $1::uuid AND status = 'ACTIVE'
       AND ($2::text IS NULL OR legal_name ILIKE '%' || $2 || '%') ORDER BY legal_name, id`,
    [context.organizationId, search ?? null],
  );
  const branchResult = await database.query<{ id: string; company_id: string; code: string; name: string }>(
    `SELECT id, company_id, code, name FROM branches WHERE organization_id = $1::uuid AND status = 'ACTIVE' ORDER BY name, id`,
    [context.organizationId],
  );
  const authorized = companyResult.rows.map((company) => {
    const target = { organizationId: context.organizationId, companyId: company.id, branchId: null };
    const canRead = hasPermission(context, "settings.read", target);
    const canUpdate = hasPermission(context, "settings.update", target);
    const branches = branchResult.rows.filter((branch) => branch.company_id === company.id).map((branch) => {
      const branchTarget = { organizationId: context.organizationId, companyId: company.id, branchId: branch.id };
      return {
        id: branch.id,
        code: branch.code,
        name: branch.name,
        canRead: hasPermission(context, "settings.read", branchTarget),
        canUpdate: hasPermission(context, "settings.update", branchTarget),
      };
    }).filter((branch) => branch.canRead || branch.canUpdate);
    return { id: company.id, legalName: company.legal_name, canRead, canUpdate, branches };
  }).filter((company) => company.canRead || company.canUpdate || company.branches.length > 0);
  const selected = input.companyId ? authorized.filter((company) => company.id === input.companyId) : authorized;
  const organizationTarget = await loadScopeTarget(database, context.organizationId);
  const organizationCanRead = hasPermission(context, "settings.read", accessTarget(organizationTarget));
  const organizationCanUpdate = hasPermission(context, "settings.update", accessTarget(organizationTarget));
  return {
    organization: { canRead: organizationCanRead, canUpdate: organizationCanUpdate },
    companies: selected.slice(input.offset, input.offset + input.limit),
    totalCompanies: selected.length,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function listSettings(database: Pool, session: AuthenticatedSession, input: PageQuery & { companyId?: string; branchId?: string }) {
  const context = await loadContext(database, session, "settings.read");
  const target = await loadScopeTarget(database, context.organizationId, input.companyId, input.branchId);
  requireTargetPermission(context, "settings.read", target);
  const { where, values } = scopeFilter(target);
  const search = normalizeSearch(input.search);
  const filter = search ? ` AND key ILIKE '%' || $${values.length + 1} || '%'` : "";
  const count = await database.query<{ total: string }>(`SELECT count(*)::text AS total FROM settings WHERE ${where}${filter}`, search ? [...values, search] : values);
  const pageValues = search ? [...values, search, input.limit, input.offset] : [...values, input.limit, input.offset];
  const limitIndex = values.length + (search ? 2 : 1);
  const items = await database.query<SettingRow>(
    `SELECT id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_at
     FROM settings WHERE ${where}${filter} ORDER BY key LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
    pageValues,
  );
  return { items: items.rows.map(mapSetting), total: Number(count.rows[0]?.total ?? 0), limit: input.limit, offset: input.offset };
}

export async function getEffectiveSettings(
  database: Pool,
  session: AuthenticatedSession,
  input: { companyId?: string; branchId?: string },
) {
  const context = await loadContext(database, session, "settings.read");
  const target = await loadScopeTarget(database, context.organizationId, input.companyId, input.branchId);
  requireTargetPermission(context, "settings.read", target);
  const companyFallback = target.companyName;
  const rows = await database.query<SettingRow>(
    `SELECT id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_at
     FROM settings
     WHERE scope_type = 'INSTALLATION'
        OR (organization_id = $1::uuid AND scope_type = 'ORGANIZATION')
        OR (company_id = $2::uuid AND scope_type = 'COMPANY')
        OR (branch_id = $3::uuid AND scope_type = 'BRANCH')
     ORDER BY CASE scope_type WHEN 'INSTALLATION' THEN 1 WHEN 'ORGANIZATION' THEN 2 WHEN 'COMPANY' THEN 3 ELSE 4 END, key`,
    [target.organizationId, target.companyId, target.branchId],
  );
  const effective = new Map<SettingKey, { value: unknown; sourceScopeType: SettingScope | null; sourceOrganizationId: string | null; sourceCompanyId: string | null; sourceBranchId: string | null; updatedAt: string | null }>();
  for (const key of settingKeys) {
    if (settingScopes[key].includes("INSTALLATION")) {
      const fallback = key === "locale" ? "es" : key === "currency" ? "BOB" : key === "timeZone" ? "America/La_Paz" : null;
      effective.set(key, { value: fallback, sourceScopeType: null, sourceOrganizationId: null, sourceCompanyId: null, sourceBranchId: null, updatedAt: null });
    }
    if (key === "identity.name") effective.set(key, { value: companyFallback, sourceScopeType: null, sourceOrganizationId: null, sourceCompanyId: target.companyId, sourceBranchId: null, updatedAt: null });
    if (key === "identity.logoUrl" || key === "identity.brandColor") effective.set(key, { value: null, sourceScopeType: null, sourceOrganizationId: null, sourceCompanyId: target.companyId, sourceBranchId: null, updatedAt: null });
  }
  for (const row of rows.rows) {
    if (!settingScopes[row.key].includes(row.scope_type)) continue;
    effective.set(row.key, { value: row.value, sourceScopeType: row.scope_type, sourceOrganizationId: row.organization_id, sourceCompanyId: row.company_id, sourceBranchId: row.branch_id, updatedAt: row.updated_at.toISOString() });
  }
  return {
    target: { scopeType: target.scopeType, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId },
    items: settingKeys.filter((key) => effective.has(key)).map((key) => ({ key, valueType: "STRING" as const, ...effective.get(key) })),
  };
}

async function readSettingRows(client: PoolClient, scope: { scopeType: SettingScope; organizationId: string | null; companyId: string | null; branchId: string | null }, key: string, lock = false): Promise<SettingRow | null> {
  const where = scope.scopeType === "INSTALLATION" ? `scope_type = 'INSTALLATION' AND key = $1` :
    scope.scopeType === "ORGANIZATION" ? `scope_type = 'ORGANIZATION' AND organization_id = $1::uuid AND key = $2` :
    scope.scopeType === "COMPANY" ? `scope_type = 'COMPANY' AND company_id = $1::uuid AND key = $2` :
    `scope_type = 'BRANCH' AND branch_id = $1::uuid AND key = $2`;
  const values = scope.scopeType === "INSTALLATION" ? [key] : [scope.scopeType === "ORGANIZATION" ? scope.organizationId : scope.scopeType === "COMPANY" ? scope.companyId : scope.branchId, key];
  const result = await client.query<SettingRow>(
    `SELECT id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_at FROM settings WHERE ${where}${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  return result.rows[0] ?? null;
}

function conflictTarget(scope: SettingScope): string {
  switch (scope) {
    case "INSTALLATION": return `("key") WHERE "scope_type" = 'INSTALLATION'`;
    case "ORGANIZATION": return `("organization_id", "key") WHERE "scope_type" = 'ORGANIZATION'`;
    case "COMPANY": return `("company_id", "key") WHERE "scope_type" = 'COMPANY'`;
    case "BRANCH": return `("branch_id", "key") WHERE "scope_type" = 'BRANCH'`;
  }
}

async function saveSetting(database: Pool, session: AuthenticatedSession, input: SettingMutation, installation = false) {
  const key = requireKey(input.key);
  const value = validateSettingValue(key, input.value);
  const scope: SettingScope = installation ? "INSTALLATION" : input.scopeType;
  if (!settingScopes[key].includes(scope)) throw new AuthServiceError(400, "SETTING_SCOPE_NOT_ALLOWED", "Esta clave no admite el alcance solicitado.");
  let target: ScopeTarget | null = null;
  if (installation) {
    if (session.platformRole !== "PLATFORM_ADMIN") throw new AuthServiceError(403, "FORBIDDEN", "Solo un administrador de plataforma puede cambiar la configuración de instalación.");
  } else {
    const context = await loadContext(database, session, "settings.update");
    target = await loadScopeTarget(database, context.organizationId, input.companyId, input.branchId);
    if (target.scopeType !== input.scopeType) throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no coincide con los recursos indicados.");
    requireTargetPermission(context, "settings.update", target);
    assertTargetWritable(target);
  }
  const scopeValues = settingScopeValues(target);
  return inTransaction(database, async (client) => {
    if (target) await lockWritableTarget(client, target);
    const lockKey = `${scope}:${scopeValues.organizationId ?? ""}:${scopeValues.companyId ?? ""}:${scopeValues.branchId ?? ""}:${key}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    const before = await readSettingRows(client, scopeValues, key, true);
    let after: SettingRow | null = null;
    if (value === null) {
      if (before) await client.query("DELETE FROM settings WHERE id = $1::uuid", [before.id]);
    } else {
      const result = await client.query<SettingRow>(
        `INSERT INTO settings (id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_by, updated_at)
         VALUES ($1::uuid, $2::"SettingScopeType", $3::uuid, $4::uuid, $5::uuid, $6, 'STRING', $7::jsonb, $8::uuid, CURRENT_TIMESTAMP)
         ON CONFLICT ${conflictTarget(scope)} DO UPDATE SET value = EXCLUDED.value, value_type = EXCLUDED.value_type,
           updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
         RETURNING id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_at`,
        [randomUUID(), scope, scopeValues.organizationId, scopeValues.companyId, scopeValues.branchId, key, JSON.stringify(value), session.userId],
      );
      after = result.rows[0] ?? null;
      if (!after) throw new Error("SETTING_UPSERT_FAILED");
    }
    const changed = value === null ? Boolean(before) : JSON.stringify(before?.value) !== JSON.stringify(value);
    if (changed) {
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId }, organizationId: target?.organizationId ?? null,
        companyId: target?.companyId ?? null, branchId: target?.branchId ?? null,
        action: value === null ? "SETTING_OVERRIDE_REMOVED" : "SETTING_UPDATED", resourceType: "Setting",
        resourceId: before?.id ?? after?.id ?? null, requestId: input.requestId,
        before: before ? { key, value: before.value } : null, after: after ? { key, value: after.value } : null,
      });
    }
    return { item: after ? mapSetting(after) : null, deleted: value === null };
  });
}

export async function getInstallationSettings(database: Pool, session: AuthenticatedSession) {
  if (session.platformRole !== "PLATFORM_ADMIN") throw new AuthServiceError(403, "FORBIDDEN", "Solo un administrador de plataforma puede consultar la configuración de instalación.");
  const result = await database.query<SettingRow>(`SELECT id, scope_type, organization_id, company_id, branch_id, key, value_type, value, updated_at FROM settings WHERE scope_type = 'INSTALLATION' ORDER BY key`);
  return { items: result.rows.map(mapSetting) };
}

export async function updateInstallationSetting(database: Pool, session: AuthenticatedSession, input: Omit<SettingMutation, "scopeType" | "companyId" | "branchId">) {
  return saveSetting(database, session, { ...input, scopeType: "ORGANIZATION" }, true);
}

export async function updateSetting(database: Pool, session: AuthenticatedSession, input: SettingMutation) {
  return saveSetting(database, session, input);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(value);
}

function normalizeHours(input: Array<{ weekday: number; intervals: BusinessHourInterval[] }>): Array<{ weekday: number; intervals: BusinessHourInterval[] }> {
  if (!Array.isArray(input) || input.length !== 7 || new Set(input.map((day) => day.weekday)).size !== 7 || input.some((day) => !Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7)) {
    throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Debes enviar una configuración para cada día de lunes a domingo.");
  }
  return [...input].sort((a, b) => a.weekday - b.weekday).map((day) => {
    if (!Array.isArray(day.intervals) || day.intervals.length > 2) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Cada día admite hasta dos bloques horarios.");
    const intervals = [...day.intervals].map((item) => {
      if (!validTime(item.start) || !validTime(item.end) || item.start >= item.end) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Cada bloque debe tener hora inicial y final válidas dentro del mismo día.");
      return { start: item.start, end: item.end };
    }).sort((a, b) => a.start.localeCompare(b.start));
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (previous && current && previous.end > current.start) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Los bloques horarios no pueden solaparse.");
    }
    return { weekday: day.weekday, intervals };
  });
}

async function loadBusinessHoursTarget(database: Pool, session: AuthenticatedSession, companyId: string, branchId?: string, permission: "settings.read" | "settings.update" = "settings.read") {
  const context = await loadContext(database, session, permission);
  const target = await loadScopeTarget(database, context.organizationId, companyId, branchId);
  if (target.scopeType !== "COMPANY" && target.scopeType !== "BRANCH") throw new AuthServiceError(400, "INVALID_REQUEST", "El horario requiere una empresa o sucursal.");
  requireTargetPermission(context, permission, target);
  if (permission === "settings.update") assertTargetWritable(target);
  return { context, target };
}

export async function getBusinessHours(database: Pool, session: AuthenticatedSession, input: { companyId: string; branchId?: string }) {
  const { target } = await loadBusinessHoursTarget(database, session, input.companyId, input.branchId);
  const result = await database.query<BusinessHourRow>(
    `SELECT weekday, intervals, scope_type, updated_at FROM business_hours
     WHERE organization_id = $1::uuid AND company_id = $2::uuid AND (branch_id IS NULL OR branch_id = $3::uuid)
     ORDER BY scope_type, weekday`,
    [target.organizationId, target.companyId, target.branchId],
  );
  const byScope = new Map<string, BusinessHourRow>();
  for (const row of result.rows) byScope.set(`${row.scope_type}:${row.weekday}`, row);
  return {
    target: { scopeType: target.scopeType, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId },
    items: Array.from({ length: 7 }, (_, index) => {
      const weekday = index + 1;
      const row = target.branchId ? byScope.get(`BRANCH:${weekday}`) ?? byScope.get(`COMPANY:${weekday}`) : byScope.get(`COMPANY:${weekday}`);
      return { weekday, intervals: row?.intervals ?? [], sourceScopeType: row?.scope_type ?? null, updatedAt: row?.updated_at.toISOString() ?? null };
    }),
  };
}

export async function replaceBusinessHours(
  database: Pool,
  session: AuthenticatedSession,
  input: { companyId: string; branchId?: string; days: Array<{ weekday: number; intervals: BusinessHourInterval[] }>; requestId: string },
) {
  const days = normalizeHours(input.days);
  const { target } = await loadBusinessHoursTarget(database, session, input.companyId, input.branchId, "settings.update");
  return inTransaction(database, async (client) => {
    await lockWritableTarget(client, target);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`business-hours:${target.organizationId}:${target.companyId}:${target.branchId ?? ""}`]);
    const beforeRows = await client.query<BusinessHourRow>(
      `SELECT weekday, intervals, scope_type, updated_at FROM business_hours
       WHERE organization_id = $1::uuid AND company_id = $2::uuid AND branch_id IS NOT DISTINCT FROM $3::uuid ORDER BY weekday FOR UPDATE`,
      [target.organizationId, target.companyId, target.branchId],
    );
    await client.query(`DELETE FROM business_hours WHERE organization_id = $1::uuid AND company_id = $2::uuid AND branch_id IS NOT DISTINCT FROM $3::uuid`, [target.organizationId, target.companyId, target.branchId]);
    for (const day of days) {
      await client.query(
        `INSERT INTO business_hours (id, scope_type, organization_id, company_id, branch_id, weekday, intervals, updated_by, updated_at)
         VALUES ($1::uuid, $2::"SettingScopeType", $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8::uuid, CURRENT_TIMESTAMP)`,
        [randomUUID(), target.scopeType, target.organizationId, target.companyId, target.branchId, day.weekday, JSON.stringify(day.intervals), session.userId],
      );
    }
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      action: "BUSINESS_HOURS_REPLACED", resourceType: "BusinessHour", resourceId: target.branchId ?? target.companyId, requestId: input.requestId,
      before: { days: beforeRows.rows.map((row) => ({ weekday: row.weekday, intervals: row.intervals })) }, after: { days },
    });
    return { items: days.map((day) => ({ ...day, sourceScopeType: target.scopeType })) };
  });
}

function normalizeDocumentType(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, "_").toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9._-]{0,59}$/u.test(normalized)) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El tipo documental no es válido.");
  return normalized;
}

function normalizePeriod(value: string): string {
  const normalized = value.trim();
  if (normalized !== "ALL" && !/^\d{4}(?:-\d{2})?$/u.test(normalized)) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El período debe ser ALL, AAAA o AAAA-MM.");
  if (normalized.length === 7 && (Number(normalized.slice(5)) < 1 || Number(normalized.slice(5)) > 12)) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El mes del período no es válido.");
  return normalized;
}

function normalizePrefix(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 24 || !/^[A-Za-z0-9._/-]*$/u.test(normalized)) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El prefijo de numeración no es válido.");
  return normalized;
}

function mapSequence(row: NumberSequenceRow) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    organizationId: row.organization_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    documentType: row.document_type,
    period: row.period,
    prefix: row.prefix,
    padding: row.padding,
    nextValue: row.next_value,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadSequence(database: Pick<Pool, "query">, organizationId: string, sequenceId: string, lockClient?: PoolClient): Promise<NumberSequenceRow> {
  const result = await (lockClient ?? database).query<NumberSequenceRow>(
    `SELECT id, scope_type, organization_id, company_id, branch_id, document_type, period, prefix, padding, next_value::text, updated_at
     FROM number_sequences WHERE id = $1::uuid AND organization_id = $2::uuid${lockClient ? " FOR UPDATE" : ""}`,
    [sequenceId, organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthServiceError(404, "NUMBER_SEQUENCE_NOT_FOUND", "La numeración no está disponible.");
  return row;
}

async function authorizeSequence(database: Pool, session: AuthenticatedSession, row: NumberSequenceRow, permission: "settings.read" | "settings.update") {
  const context = await loadContext(database, session, permission);
  const target = await loadScopeTarget(database, context.organizationId, row.company_id ?? undefined, row.branch_id ?? undefined);
  if (target.scopeType !== row.scope_type) throw new AuthServiceError(404, "NUMBER_SEQUENCE_NOT_FOUND", "La numeración no está disponible.");
  requireTargetPermission(context, permission, target);
  if (permission === "settings.update") assertTargetWritable(target);
  return { context, target };
}

export async function listNumberSequences(database: Pool, session: AuthenticatedSession, input: PageQuery & { companyId?: string; branchId?: string }) {
  const context = await loadContext(database, session, "settings.read");
  const target = await loadScopeTarget(database, context.organizationId, input.companyId, input.branchId);
  requireTargetPermission(context, "settings.read", target);
  const search = normalizeSearch(input.search);
  const values: unknown[] = [target.organizationId, target.scopeType];
  const predicates = [`organization_id = $1::uuid`, `scope_type = $2::"ScopeType"`];
  if (target.companyId) { values.push(target.companyId); predicates.push(`company_id = $${values.length}::uuid`); }
  else predicates.push("company_id IS NULL");
  if (target.branchId) { values.push(target.branchId); predicates.push(`branch_id = $${values.length}::uuid`); }
  else predicates.push("branch_id IS NULL");
  if (search) { values.push(search); predicates.push(`document_type ILIKE '%' || $${values.length} || '%'`); }
  const where = predicates.join(" AND ");
  const count = await database.query<{ total: string }>(`SELECT count(*)::text AS total FROM number_sequences WHERE ${where}`, values);
  const items = await database.query<NumberSequenceRow>(
    `SELECT id, scope_type, organization_id, company_id, branch_id, document_type, period, prefix, padding, next_value::text, updated_at
     FROM number_sequences WHERE ${where} ORDER BY document_type, period LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, input.limit, input.offset],
  );
  return { items: items.rows.map(mapSequence), total: Number(count.rows[0]?.total ?? 0), limit: input.limit, offset: input.offset };
}

export async function createNumberSequence(
  database: Pool,
  session: AuthenticatedSession,
  input: { companyId?: string; branchId?: string; documentType: string; period: string; prefix: string; padding: number; requestId: string },
) {
  const context = await loadContext(database, session, "settings.update");
  const target = await loadScopeTarget(database, context.organizationId, input.companyId, input.branchId);
  requireTargetPermission(context, "settings.update", target);
  assertTargetWritable(target);
  const documentType = normalizeDocumentType(input.documentType);
  const period = normalizePeriod(input.period);
  const prefix = normalizePrefix(input.prefix);
  if (!Number.isInteger(input.padding) || input.padding < 0 || input.padding > 12) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El relleno debe estar entre 0 y 12 dígitos.");
  try {
    return await inTransaction(database, async (client) => {
      await lockWritableTarget(client, target);
      const result = await client.query<NumberSequenceRow>(
        `INSERT INTO number_sequences (id, scope_type, organization_id, company_id, branch_id, document_type, period, prefix, padding, updated_by, updated_at)
         VALUES ($1::uuid, $2::"ScopeType", $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10::uuid, CURRENT_TIMESTAMP)
         RETURNING id, scope_type, organization_id, company_id, branch_id, document_type, period, prefix, padding, next_value::text, updated_at`,
        [randomUUID(), target.scopeType, target.organizationId, target.companyId, target.branchId, documentType, period, prefix, input.padding, session.userId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("NUMBER_SEQUENCE_CREATE_FAILED");
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId }, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
        action: "NUMBER_SEQUENCE_CREATED", resourceType: "NumberSequence", resourceId: row.id, requestId: input.requestId,
        after: { documentType, period, prefix, padding: input.padding, nextValue: "1" },
      });
      return mapSequence(row);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new AuthServiceError(409, "NUMBER_SEQUENCE_EXISTS", "Ya existe una numeración para ese tipo y período en este alcance.");
    }
    throw error;
  }
}

export async function updateNumberSequence(database: Pool, session: AuthenticatedSession, input: { sequenceId: string; prefix?: string; padding?: number; requestId: string }) {
  const organizationId = requireOrganizationId(session);
  const current = await loadSequence(database, organizationId, input.sequenceId);
  const { target } = await authorizeSequence(database, session, current, "settings.update");
  const prefix = input.prefix === undefined ? current.prefix : normalizePrefix(input.prefix);
  const padding = input.padding === undefined ? current.padding : input.padding;
  if (!Number.isInteger(padding) || padding < 0 || padding > 12) throw new AuthServiceError(400, "INVALID_SEQUENCE", "El relleno debe estar entre 0 y 12 dígitos.");
  if (prefix === current.prefix && padding === current.padding) return mapSequence(current);
  return inTransaction(database, async (client) => {
    await lockWritableTarget(client, target);
    const locked = await loadSequence(database, organizationId, current.id, client);
    if (BigInt(locked.next_value) > 1n) throw new AuthServiceError(409, "SEQUENCE_ALREADY_USED", "Una numeración que ya emitió números no puede cambiar su formato.");
    const result = await client.query<NumberSequenceRow>(
      `UPDATE number_sequences SET prefix = $2, padding = $3, updated_by = $4::uuid, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid RETURNING id, scope_type, organization_id, company_id, branch_id, document_type, period, prefix, padding, next_value::text, updated_at`,
      [current.id, prefix, padding, session.userId],
    );
    const updated = result.rows[0];
    if (!updated) throw new AuthServiceError(404, "NUMBER_SEQUENCE_NOT_FOUND", "La numeración no está disponible.");
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      action: "NUMBER_SEQUENCE_UPDATED", resourceType: "NumberSequence", resourceId: updated.id, requestId: input.requestId,
      before: { prefix: current.prefix, padding: current.padding }, after: { prefix, padding },
    });
    return mapSequence(updated);
  });
}

export async function issueNumber(database: Pool, session: AuthenticatedSession, input: { sequenceId: string; requestId: string }) {
  const organizationId = requireOrganizationId(session);
  const current = await loadSequence(database, organizationId, input.sequenceId);
  const { target } = await authorizeSequence(database, session, current, "settings.update");
  return inTransaction(database, async (client) => {
    await lockWritableTarget(client, target);
    const locked = await loadSequence(database, organizationId, current.id, client);
    assertTargetWritable(target);
    const result = await client.query<{ next_value: string }>(
      `UPDATE number_sequences SET next_value = next_value + 1, updated_by = $2::uuid, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid RETURNING next_value::text`,
      [locked.id, session.userId],
    );
    const nextValue = BigInt(result.rows[0]?.next_value ?? "0");
    if (nextValue < 2n) throw new Error("NUMBER_SEQUENCE_ISSUE_FAILED");
    const numericPart = String(nextValue - 1n).padStart(locked.padding, "0");
    const periodPart = locked.period === "ALL" ? "" : `${locked.period}-`;
    const number = `${locked.document_type}-${locked.prefix}${periodPart}${numericPart}`;
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      action: "NUMBER_SEQUENCE_ISSUED", resourceType: "NumberSequence", resourceId: locked.id, requestId: input.requestId,
      before: { nextValue: locked.next_value }, after: { issuedNumber: number, nextValue: nextValue.toString() },
    });
    return { sequenceId: locked.id, documentType: locked.document_type, period: locked.period, number };
  });
}
