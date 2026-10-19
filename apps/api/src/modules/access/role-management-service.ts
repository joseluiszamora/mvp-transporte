import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";
import { hasPermission, resolveAccessContext, type AccessContext, type AccessTarget, type ScopeType } from "./access-context.ts";
import { permissionDefinitions, tenantAdminPermissionCodes } from "./permission-catalog.ts";

type RoleStatus = "ACTIVE" | "INACTIVE";
type RoleOptionKind = "memberships" | "companies" | "branches";

interface RoleRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  status: RoleStatus;
  permissions: string[];
  assignment_count: number;
  created_at: Date;
}

interface RoleAssignmentRow extends QueryResultRow {
  id: string;
  membership_id: string;
  user_email: string;
  user_display_name: string;
  role_id: string;
  role_code: string;
  role_name: string;
  role_status: RoleStatus;
  scope_type: ScopeType;
  company_id: string | null;
  company_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  created_at: Date;
}

interface TransactionContext {
  client: PoolClient;
  organizationId: string;
  actor: AccessContext;
  requestId: string;
}

const tenantPermissionCodes = new Set<string>(tenantAdminPermissionCodes);
const organizationTarget = (organizationId: string): AccessTarget => ({ organizationId });

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  return session.organizationId;
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 120 || /[\r\n\0]/u.test(name)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return name;
}

function validatePermissionCodes(value: readonly string[]): string[] {
  if (value.length > tenantPermissionCodes.size || new Set(value).size !== value.length) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La lista de permisos no es válida.");
  }
  for (const code of value) {
    if (!tenantPermissionCodes.has(code)) {
      throw new AuthServiceError(400, "INVALID_PERMISSION", "La lista de permisos no es válida.");
    }
  }
  return [...value].sort();
}

async function loadActor(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  permissionCode: string,
  target?: AccessTarget,
): Promise<{ organizationId: string; context: AccessContext }> {
  const organizationId = requireOrganizationId(session);
  const context = await resolveAccessContext(database, session.userId, organizationId);
  if (!context || !hasPermission(context, permissionCode, target ?? organizationTarget(organizationId))) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
  return { organizationId, context };
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

async function lockOrganization(client: PoolClient, organizationId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`mvp-transporte:role-management:${organizationId}`]);
}

async function loadWriteContext(
  client: PoolClient,
  session: AuthenticatedSession,
  permissionCode: string,
  requestId: string,
): Promise<TransactionContext> {
  const organizationId = requireOrganizationId(session);
  await lockOrganization(client, organizationId);
  const actor = await resolveAccessContext(client, session.userId, organizationId);
  if (!actor || !hasPermission(actor, permissionCode, organizationTarget(organizationId))) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
  return { client, organizationId, actor, requestId };
}

function assertGrantablePermissions(
  context: AccessContext,
  organizationId: string,
  permissionCodes: readonly string[],
): void {
  const target = organizationTarget(organizationId);
  if (permissionCodes.some((code) => !hasPermission(context, code, target))) {
    throw new AuthServiceError(403, "PRIVILEGE_ESCALATION", "No puedes conceder permisos que no tienes.");
  }
}

async function replaceRolePermissions(
  client: PoolClient,
  organizationId: string,
  roleId: string,
  permissionCodes: readonly string[],
): Promise<void> {
  await client.query("DELETE FROM role_permissions WHERE organization_id = $1::uuid AND role_id = $2::uuid", [organizationId, roleId]);
  for (const code of permissionCodes) {
    await client.query(
      `INSERT INTO role_permissions (organization_id, role_id, permission_code)
       VALUES ($1::uuid, $2::uuid, $3)`,
      [organizationId, roleId, code],
    );
  }
}

async function countActiveAdministrators(client: PoolClient, organizationId: string): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT count(DISTINCT membership.id)::int AS total
     FROM organization_memberships AS membership
     JOIN users AS app_user ON app_user.id = membership.user_id
     JOIN role_assignments AS assignment
       ON assignment.membership_id = membership.id AND assignment.organization_id = membership.organization_id
     JOIN roles AS role ON role.id = assignment.role_id AND role.organization_id = assignment.organization_id
     WHERE membership.organization_id = $1::uuid
       AND membership.status = 'ACTIVE' AND app_user.status = 'ACTIVE' AND role.status = 'ACTIVE'
       AND assignment.scope_type = 'ORGANIZATION' AND assignment.company_id IS NULL AND assignment.branch_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM unnest($2::text[]) AS required(permission_code)
         WHERE NOT EXISTS (
           SELECT 1 FROM role_permissions AS role_permission
           WHERE role_permission.role_id = role.id
             AND role_permission.organization_id = role.organization_id
             AND role_permission.permission_code = required.permission_code
         )
       )`,
    [organizationId, tenantAdminPermissionCodes],
  );
  return result.rows[0]?.total ?? 0;
}

async function ensureAdministratorRemains(client: PoolClient, organizationId: string): Promise<void> {
  if ((await countActiveAdministrators(client, organizationId)) === 0) {
    throw new AuthServiceError(409, "LAST_ADMIN_REQUIRED", "La organización debe conservar al menos un administrador activo.");
  }
}

export async function listPermissionCatalog(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
): Promise<Array<{ code: string; description: string }>> {
  const { organizationId, context } = await loadActor(database, session, "roles.read");
  if (!hasPermission(context, "roles.read", organizationTarget(organizationId))) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
  return permissionDefinitions
    .filter(([code]) => tenantPermissionCodes.has(code))
    .map(([code, description]) => ({ code, description }));
}

export async function listOrganizationRoles(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { organizationId } = await loadActor(database, session, "roles.read");
  const [totalResult, rows] = await Promise.all([
    database.query<{ total: number }>("SELECT count(*)::int AS total FROM roles WHERE organization_id = $1::uuid", [organizationId]),
    database.query<RoleRow>(
      `SELECT role.id, role.code, role.name, role.status, role.created_at,
         COALESCE(array_agg(DISTINCT role_permission.permission_code ORDER BY role_permission.permission_code)
           FILTER (WHERE role_permission.permission_code IS NOT NULL), ARRAY[]::text[]) AS permissions,
         count(DISTINCT assignment.id)::int AS assignment_count
       FROM roles AS role
       LEFT JOIN role_permissions AS role_permission
         ON role_permission.role_id = role.id AND role_permission.organization_id = role.organization_id
       LEFT JOIN role_assignments AS assignment
         ON assignment.role_id = role.id AND assignment.organization_id = role.organization_id
       WHERE role.organization_id = $1::uuid
       GROUP BY role.id
       ORDER BY role.code, role.id
       LIMIT $2 OFFSET $3`,
      [organizationId, input.limit, input.offset],
    ),
  ]);
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      permissions: row.permissions,
      assignmentCount: row.assignment_count,
      createdAt: row.created_at.toISOString(),
    })),
    total: totalResult.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function createOrganizationRole(
  database: Pool,
  session: AuthenticatedSession,
  input: { name: string; permissionCodes: readonly string[]; requestId: string },
): Promise<{ id: string; code: string; name: string; status: RoleStatus; permissions: string[] }> {
  const name = normalizeName(input.name);
  const permissionCodes = validatePermissionCodes(input.permissionCodes);
  return transaction(database, async (client) => {
    const context = await loadWriteContext(client, session, "roles.create", input.requestId);
    assertGrantablePermissions(context.actor, context.organizationId, permissionCodes);
    const id = randomUUID();
    const code = `custom-${id}`;
    await client.query(
      `INSERT INTO roles (id, organization_id, code, name, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)`,
      [id, context.organizationId, code, name],
    );
    await replaceRolePermissions(client, context.organizationId, id, permissionCodes);
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId: context.organizationId,
      action: "ROLE_CREATED",
      resourceType: "Role",
      resourceId: id,
      requestId: input.requestId,
      after: { code, name, status: "ACTIVE", permissions: permissionCodes },
    });
    return { id, code, name, status: "ACTIVE", permissions: permissionCodes };
  });
}

export async function updateOrganizationRole(
  database: Pool,
  session: AuthenticatedSession,
  input: { roleId: string; name?: string; status?: RoleStatus; permissionCodes?: readonly string[]; requestId: string },
): Promise<{ id: string; code: string; name: string; status: RoleStatus; permissions: string[] }> {
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  const permissionCodes = input.permissionCodes === undefined ? undefined : validatePermissionCodes(input.permissionCodes);
  if (name === undefined && input.status === undefined && permissionCodes === undefined) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return transaction(database, async (client) => {
    const context = await loadWriteContext(client, session, "roles.update", input.requestId);
    if (permissionCodes) {
      assertGrantablePermissions(context.actor, context.organizationId, permissionCodes);
    }
    const existing = await client.query<{ id: string; code: string; name: string; status: RoleStatus }>(
      `SELECT id, code, name, status FROM roles
       WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      [input.roleId, context.organizationId],
    );
    const roleRow = existing.rows[0];
    if (!roleRow) {
      throw new AuthServiceError(404, "ROLE_NOT_FOUND", "Rol no disponible.");
    }
    const existingPermissions = await client.query<{ permission_code: string }>(
      `SELECT permission_code FROM role_permissions
       WHERE role_id = $1::uuid AND organization_id = $2::uuid ORDER BY permission_code`,
      [roleRow.id, context.organizationId],
    );
    const role = { ...roleRow, permissions: existingPermissions.rows.map((row) => row.permission_code) };
    const nextName = name ?? role.name;
    const nextStatus = input.status ?? role.status;
    const nextPermissions = permissionCodes ?? role.permissions;
    await client.query(
      `UPDATE roles SET name = $3, status = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid AND organization_id = $2::uuid`,
      [role.id, context.organizationId, nextName, nextStatus],
    );
    if (permissionCodes !== undefined) {
      await replaceRolePermissions(client, context.organizationId, role.id, permissionCodes);
    }
    await ensureAdministratorRemains(client, context.organizationId);
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId: context.organizationId,
      action: "ROLE_UPDATED",
      resourceType: "Role",
      resourceId: role.id,
      requestId: input.requestId,
      before: { name: role.name, status: role.status, permissions: role.permissions },
      after: { name: nextName, status: nextStatus, permissions: nextPermissions },
    });
    return { id: role.id, code: role.code, name: nextName, status: nextStatus, permissions: nextPermissions };
  });
}

export async function listOrganizationRoleAssignments(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { organizationId } = await loadActor(database, session, "roles.read");
  const [totalResult, rows] = await Promise.all([
    database.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM role_assignments WHERE organization_id = $1::uuid",
      [organizationId],
    ),
    database.query<RoleAssignmentRow>(
      `SELECT assignment.id, assignment.membership_id, app_user.normalized_email AS user_email,
         app_user.display_name AS user_display_name, assignment.role_id, role.code AS role_code,
         role.name AS role_name, role.status AS role_status, assignment.scope_type,
         assignment.company_id, company.legal_name AS company_name,
         assignment.branch_id, branch.name AS branch_name, assignment.created_at
       FROM role_assignments AS assignment
       JOIN organization_memberships AS membership
         ON membership.id = assignment.membership_id AND membership.organization_id = assignment.organization_id
       JOIN users AS app_user ON app_user.id = membership.user_id
       JOIN roles AS role ON role.id = assignment.role_id AND role.organization_id = assignment.organization_id
       LEFT JOIN companies AS company
         ON company.id = assignment.company_id AND company.organization_id = assignment.organization_id
       LEFT JOIN branches AS branch
         ON branch.id = assignment.branch_id AND branch.company_id = assignment.company_id
           AND branch.organization_id = assignment.organization_id
       WHERE assignment.organization_id = $1::uuid
       ORDER BY app_user.display_name, role.code, assignment.created_at, assignment.id
       LIMIT $2 OFFSET $3`,
      [organizationId, input.limit, input.offset],
    ),
  ]);
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleStatus: row.role_status,
      scopeType: row.scope_type,
      companyId: row.company_id,
      companyName: row.company_name,
      branchId: row.branch_id,
      branchName: row.branch_name,
      createdAt: row.created_at.toISOString(),
    })),
    total: totalResult.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function listRoleAssignmentOptions(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { kind: RoleOptionKind; limit: number; offset: number; companyId?: string },
): Promise<{ items: Array<Record<string, string>>; total: number; limit: number; offset: number }> {
  const { organizationId } = await loadActor(database, session, "roles.assign");
  let countSql: string;
  let itemsSql: string;
  let values: unknown[];
  if (input.kind === "memberships") {
    countSql = `SELECT count(*)::int AS total FROM organization_memberships AS membership
      JOIN users AS app_user ON app_user.id = membership.user_id
      WHERE membership.organization_id = $1::uuid AND membership.status = 'ACTIVE' AND app_user.status = 'ACTIVE'`;
    itemsSql = `SELECT membership.id, app_user.display_name AS name, app_user.normalized_email AS detail
      FROM organization_memberships AS membership JOIN users AS app_user ON app_user.id = membership.user_id
      WHERE membership.organization_id = $1::uuid AND membership.status = 'ACTIVE' AND app_user.status = 'ACTIVE'
      ORDER BY app_user.display_name, app_user.normalized_email LIMIT $2 OFFSET $3`;
    values = [organizationId, input.limit, input.offset];
  } else if (input.kind === "companies") {
    countSql = "SELECT count(*)::int AS total FROM companies WHERE organization_id = $1::uuid AND status = 'ACTIVE'";
    itemsSql = `SELECT id, legal_name AS name, COALESCE(trade_name, '') AS detail FROM companies
      WHERE organization_id = $1::uuid AND status = 'ACTIVE' ORDER BY legal_name, id LIMIT $2 OFFSET $3`;
    values = [organizationId, input.limit, input.offset];
  } else {
    countSql = `SELECT count(*)::int AS total FROM branches AS branch
      JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
      WHERE branch.organization_id = $1::uuid AND branch.status = 'ACTIVE' AND company.status = 'ACTIVE'
        AND ($2::uuid IS NULL OR branch.company_id = $2::uuid)`;
    itemsSql = `SELECT branch.id, branch.name, company.legal_name AS detail FROM branches AS branch
      JOIN companies AS company ON company.id = branch.company_id AND company.organization_id = branch.organization_id
      WHERE branch.organization_id = $1::uuid AND branch.status = 'ACTIVE' AND company.status = 'ACTIVE'
        AND ($2::uuid IS NULL OR branch.company_id = $2::uuid)
      ORDER BY company.legal_name, branch.name, branch.id LIMIT $3 OFFSET $4`;
    values = [organizationId, input.companyId ?? null, input.limit, input.offset];
  }
  const countValues = input.kind === "branches" ? [organizationId, input.companyId ?? null] : [organizationId];
  const [totalResult, items] = await Promise.all([
    database.query<{ total: number }>(countSql, countValues),
    database.query<{ id: string; name: string; detail: string }>(itemsSql, values),
  ]);
  return { items: items.rows, total: totalResult.rows[0]?.total ?? 0, limit: input.limit, offset: input.offset };
}

async function loadScopeTarget(
  client: PoolClient,
  organizationId: string,
  input: { scopeType: ScopeType; companyId?: string | null; branchId?: string | null },
): Promise<AccessTarget> {
  if (input.scopeType === "ORGANIZATION") {
    if (input.companyId || input.branchId) {
      throw new AuthServiceError(400, "INVALID_SCOPE", "El alcance no es válido.");
    }
    return organizationTarget(organizationId);
  }
  if (!input.companyId) {
    throw new AuthServiceError(400, "INVALID_SCOPE", "El alcance no es válido.");
  }
  const company = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM companies WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
    [input.companyId, organizationId],
  );
  if (company.rows[0]?.status !== "ACTIVE") {
    throw new AuthServiceError(404, "SCOPE_NOT_FOUND", "El alcance no está disponible.");
  }
  if (input.scopeType === "COMPANY") {
    if (input.branchId) {
      throw new AuthServiceError(400, "INVALID_SCOPE", "El alcance no es válido.");
    }
    return { organizationId, companyId: input.companyId };
  }
  if (!input.branchId) {
    throw new AuthServiceError(400, "INVALID_SCOPE", "El alcance no es válido.");
  }
  const branch = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM branches WHERE id = $1::uuid AND company_id = $2::uuid
       AND organization_id = $3::uuid FOR UPDATE`,
    [input.branchId, input.companyId, organizationId],
  );
  if (branch.rows[0]?.status !== "ACTIVE") {
    throw new AuthServiceError(404, "SCOPE_NOT_FOUND", "El alcance no está disponible.");
  }
  return { organizationId, companyId: input.companyId, branchId: input.branchId };
}

export async function createRoleAssignment(
  database: Pool,
  session: AuthenticatedSession,
  input: {
    membershipId: string;
    roleId: string;
    scopeType: ScopeType;
    companyId?: string;
    branchId?: string;
    requestId: string;
  },
): Promise<{ id: string; membershipId: string; roleId: string; scopeType: ScopeType; companyId: string | null; branchId: string | null }> {
  const organizationId = requireOrganizationId(session);
  return transaction(database, async (client) => {
    await lockOrganization(client, organizationId);
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    }
    const membership = await client.query<{ id: string }>(
      `SELECT membership.id FROM organization_memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.id = $1::uuid AND membership.organization_id = $2::uuid
         AND membership.status = 'ACTIVE' AND app_user.status = 'ACTIVE'
       FOR UPDATE OF membership`,
      [input.membershipId, organizationId],
    );
    if (!membership.rows[0]) {
      throw new AuthServiceError(404, "MEMBERSHIP_NOT_FOUND", "La membresía no está disponible.");
    }
    const roleResult = await client.query<{ id: string; status: RoleStatus; permissions: string[] }>(
      `SELECT id, status FROM roles
       WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      [input.roleId, organizationId],
    );
    const roleRow = roleResult.rows[0];
    if (roleRow?.status !== "ACTIVE") {
      throw new AuthServiceError(404, "ROLE_NOT_FOUND", "El rol no está disponible.");
    }
    const rolePermissionRows = await client.query<{ permission_code: string }>(
      "SELECT permission_code FROM role_permissions WHERE role_id = $1::uuid AND organization_id = $2::uuid ORDER BY permission_code",
      [roleRow.id, organizationId],
    );
    const role = { ...roleRow, permissions: rolePermissionRows.rows.map((row) => row.permission_code) };
    const target = await loadScopeTarget(client, organizationId, input);
    if (!hasPermission(actor, "roles.assign", target) || role.permissions.some((code) => !hasPermission(actor, code, target))) {
      throw new AuthServiceError(403, "PRIVILEGE_ESCALATION", "No puedes asignar permisos fuera de tu alcance.");
    }
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM role_assignments
       WHERE membership_id = $1::uuid AND role_id = $2::uuid AND organization_id = $3::uuid
         AND scope_type = $4 AND company_id IS NOT DISTINCT FROM $5::uuid
         AND branch_id IS NOT DISTINCT FROM $6::uuid`,
      [input.membershipId, input.roleId, organizationId, input.scopeType, target.companyId ?? null, target.branchId ?? null],
    );
    if (duplicate.rows[0]) {
      throw new AuthServiceError(409, "ROLE_ALREADY_ASSIGNED", "Ese rol ya está asignado con el mismo alcance.");
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type, company_id, branch_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid)`,
      [id, organizationId, input.membershipId, input.roleId, input.scopeType, target.companyId ?? null, target.branchId ?? null],
    );
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId,
      companyId: target.companyId ?? null,
      branchId: target.branchId ?? null,
      action: "ROLE_ASSIGNED",
      resourceType: "RoleAssignment",
      resourceId: id,
      requestId: input.requestId,
      after: { membershipId: input.membershipId, roleId: input.roleId, scopeType: input.scopeType, companyId: target.companyId ?? null, branchId: target.branchId ?? null },
    });
    return { id, membershipId: input.membershipId, roleId: input.roleId, scopeType: input.scopeType, companyId: target.companyId ?? null, branchId: target.branchId ?? null };
  });
}

export async function deleteRoleAssignment(
  database: Pool,
  session: AuthenticatedSession,
  input: { assignmentId: string; requestId: string },
): Promise<void> {
  const organizationId = requireOrganizationId(session);
  await transaction(database, async (client) => {
    await lockOrganization(client, organizationId);
    const actor = await resolveAccessContext(client, session.userId, organizationId);
    if (!actor) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    }
    const assignmentResult = await client.query<{
      id: string;
      membership_id: string;
      role_id: string;
      scope_type: ScopeType;
      company_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT id, membership_id, role_id, scope_type, company_id, branch_id FROM role_assignments
       WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      [input.assignmentId, organizationId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      throw new AuthServiceError(404, "ROLE_ASSIGNMENT_NOT_FOUND", "La asignación no está disponible.");
    }
    const target: AccessTarget = {
      organizationId,
      companyId: assignment.company_id,
      branchId: assignment.branch_id,
    };
    if (!hasPermission(actor, "roles.assign", target)) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    }
    await client.query("DELETE FROM role_assignments WHERE id = $1::uuid AND organization_id = $2::uuid", [assignment.id, organizationId]);
    await ensureAdministratorRemains(client, organizationId);
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId,
      companyId: assignment.company_id,
      branchId: assignment.branch_id,
      action: "ROLE_UNASSIGNED",
      resourceType: "RoleAssignment",
      resourceId: assignment.id,
      requestId: input.requestId,
      before: { membershipId: assignment.membership_id, roleId: assignment.role_id, scopeType: assignment.scope_type, companyId: assignment.company_id, branchId: assignment.branch_id },
    });
  });
}

export function parseRoleOptionKind(value: string | undefined): RoleOptionKind {
  if (value === "memberships" || value === "companies" || value === "branches") {
    return value;
  }
  throw new AuthServiceError(400, "INVALID_REQUEST", "El tipo de opción no es válido.");
}

export function parseRoleStatus(value: unknown): RoleStatus {
  if (value === "ACTIVE" || value === "INACTIVE") {
    return value;
  }
  throw new AuthServiceError(400, "INVALID_REQUEST", "El estado del rol no es válido.");
}
