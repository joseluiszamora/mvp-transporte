import type { Pool, QueryResultRow } from "pg";
import { resolveAccessContext, type AccessContext } from "../access/access-context.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";
import { sanitizeStoredAuditDiff } from "./audit-service.ts";

interface AuditEventRow extends QueryResultRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  branch_id: string | null;
  actor_id: string | null;
  actor_type: "USER" | "SYSTEM";
  action: string;
  resource_type: string;
  resource_id: string | null;
  diff: unknown;
  request_id: string;
  created_at: Date;
}

export interface AuditPageInput {
  limit: number;
  offset: number;
  from?: Date;
  to?: Date;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
}

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId || !session.selectedMembershipId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa para continuar.");
  }
  return session.organizationId;
}

async function loadContext(database: Pool, session: AuthenticatedSession): Promise<AccessContext> {
  const context = await resolveAccessContext(database, session.userId, requireOrganizationId(session));
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar la auditoría.");
  return context;
}

function auditVisibility(context: AccessContext) {
  const grants = context.grants.filter((grant) => grant.permissionCode === "audit.read" && grant.organizationId === context.organizationId);
  return {
    organization: grants.some((grant) => grant.scopeType === "ORGANIZATION"),
    companies: [...new Set(grants.filter((grant) => grant.scopeType === "COMPANY" && grant.companyId).map((grant) => grant.companyId as string))],
    branches: [...new Set(grants.filter((grant) => grant.scopeType === "BRANCH" && grant.branchId).map((grant) => grant.branchId as string))],
  };
}

function hasAuditScope(context: AccessContext): boolean {
  const scope = auditVisibility(context);
  return scope.organization || scope.companies.length > 0 || scope.branches.length > 0;
}

const visibilitySql = `(
  $2::boolean
  OR event.company_id = ANY($3::uuid[])
  OR (event.resource_type = 'Company' AND EXISTS (
    SELECT 1 FROM unnest($3::uuid[]) AS allowed_company(id) WHERE event.resource_id = allowed_company.id::text
  ))
  OR (event.resource_type = 'RoleAssignment' AND EXISTS (
    SELECT 1 FROM unnest($3::uuid[]) AS allowed_company(id)
    WHERE COALESCE(event.diff->'after'->>'companyId', event.diff->'before'->>'companyId') = allowed_company.id::text
  ))
  OR event.branch_id = ANY($4::uuid[])
  OR (event.resource_type = 'Branch' AND EXISTS (
    SELECT 1 FROM unnest($4::uuid[]) AS allowed_branch(id) WHERE event.resource_id = allowed_branch.id::text
  ))
  OR (event.resource_type = 'RoleAssignment' AND EXISTS (
    SELECT 1 FROM unnest($4::uuid[]) AS allowed_branch(id)
    WHERE COALESCE(event.diff->'after'->>'branchId', event.diff->'before'->>'branchId') = allowed_branch.id::text
  ))
  OR (event.resource_type = 'Employee' AND EXISTS (
    SELECT 1 FROM employee_branch_assignments AS assignment
    WHERE assignment.employee_id::text = event.resource_id AND assignment.organization_id = event.organization_id
      AND assignment.branch_id = ANY($4::uuid[])
  ))
  OR (event.resource_type = 'File' AND EXISTS (
    SELECT 1 FROM employees AS employee
    JOIN employee_branch_assignments AS assignment
      ON assignment.employee_id = employee.id AND assignment.organization_id = employee.organization_id
    WHERE employee.organization_id = event.organization_id AND assignment.branch_id = ANY($4::uuid[])
      AND (
        employee.id::text = COALESCE(event.diff->'after'->>'employeeId', event.diff->'before'->>'employeeId')
        OR EXISTS (
          SELECT 1 FROM file_links AS link
          WHERE link.file_id::text = event.resource_id AND link.resource_id = employee.id
            AND link.resource_type IN ('EMPLOYEE_PHOTO', 'EMPLOYEE_DOCUMENT')
        )
      )
  ))
)`;

function whereSql(): string {
  return `event.organization_id = $1::uuid AND ${visibilitySql}
    AND ($5::timestamptz IS NULL OR event.created_at >= $5::timestamptz)
    AND ($6::timestamptz IS NULL OR event.created_at <= $6::timestamptz)
    AND ($7::uuid IS NULL OR event.actor_id = $7::uuid)
    AND ($8::text IS NULL OR strpos(lower(event.action), lower($8::text)) > 0)
    AND ($9::text IS NULL OR strpos(lower(event.resource_type), lower($9::text)) > 0)
    AND ($10::text IS NULL OR strpos(lower(COALESCE(event.resource_id, '')), lower($10::text)) > 0)`;
}

function mapEvent(row: AuditEventRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestId: row.request_id,
    createdAt: row.created_at.toISOString(),
  };
}

function filterValues(organizationId: string, context: AccessContext, input: AuditPageInput): unknown[] {
  const visibility = auditVisibility(context);
  return [organizationId, visibility.organization, visibility.companies, visibility.branches,
    input.from ?? null, input.to ?? null, input.actorId ?? null, input.action ?? null,
    input.resourceType ?? null, input.resourceId ?? null];
}

export async function listAuditEvents(database: Pool, session: AuthenticatedSession, input: AuditPageInput) {
  const organizationId = requireOrganizationId(session);
  const context = await loadContext(database, session);
  if (!hasAuditScope(context)) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar la auditoría.");
  const values = filterValues(organizationId, context, input);
  const where = whereSql();
  const count = await database.query<{ total: string }>(`SELECT count(*)::text AS total FROM audit_events AS event WHERE ${where}`, values);
  const rows = await database.query<AuditEventRow>(
    `SELECT event.id, event.organization_id, event.company_id, event.branch_id, event.actor_id, event.actor_type,
       event.action, event.resource_type, event.resource_id, event.request_id, event.created_at
     FROM audit_events AS event WHERE ${where}
     ORDER BY event.created_at DESC, event.id DESC LIMIT $11 OFFSET $12`,
    [...values, input.limit, input.offset],
  );
  return { items: rows.rows.map(mapEvent), total: Number(count.rows[0]?.total ?? "0"), limit: input.limit, offset: input.offset };
}

export async function getAuditEvent(database: Pool, session: AuthenticatedSession, eventId: string) {
  const organizationId = requireOrganizationId(session);
  const context = await loadContext(database, session);
  if (!hasAuditScope(context)) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar la auditoría.");
  const values = filterValues(organizationId, context, { limit: 1, offset: 0 });
  const result = await database.query<AuditEventRow>(
    `SELECT event.id, event.organization_id, event.company_id, event.branch_id, event.actor_id, event.actor_type,
       event.action, event.resource_type, event.resource_id, event.diff, event.request_id, event.created_at
     FROM audit_events AS event WHERE ${whereSql()} AND event.id = $11::uuid LIMIT 1`,
    [...values, eventId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthServiceError(404, "AUDIT_EVENT_NOT_FOUND", "El evento no está disponible.");
  return { item: { ...mapEvent(row), diff: sanitizeStoredAuditDiff(row.diff) } };
}