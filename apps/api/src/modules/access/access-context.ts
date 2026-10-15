import type { Pool, QueryResultRow } from "pg";

export type ScopeType = "ORGANIZATION" | "COMPANY" | "BRANCH";

export interface AccessTarget {
  organizationId: string;
  companyId?: string | null;
  branchId?: string | null;
}

interface AccessContextRow extends QueryResultRow {
  membership_id: string;
  user_id: string;
  user_status: string;
  organization_id: string;
  organization_status: string;
  membership_status: string;
  role_status: string | null;
  scope_type: ScopeType | null;
  company_id: string | null;
  branch_id: string | null;
  permission_code: string | null;
}

export interface AccessGrant {
  organizationId: string;
  permissionCode: string;
  scopeType: ScopeType;
  companyId: string | null;
  branchId: string | null;
}

export interface AccessContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  grants: readonly AccessGrant[];
}

function hasValidScopeShape(row: AccessContextRow): boolean {
  if (row.scope_type === "ORGANIZATION") {
    return row.company_id === null && row.branch_id === null;
  }
  if (row.scope_type === "COMPANY") {
    return row.company_id !== null && row.branch_id === null;
  }
  return row.scope_type === "BRANCH" && row.company_id !== null && row.branch_id !== null;
}

/** Loads current membership and role grants for one authenticated user and selected tenant. */
export async function resolveAccessContext(
  database: Pick<Pool, "query">,
  userId: string,
  organizationId: string,
): Promise<AccessContext | null> {
  const result = await database.query<AccessContextRow>(
    `
      SELECT
        membership.id AS membership_id,
        app_user.id AS user_id,
        app_user.status AS user_status,
        organization.id AS organization_id,
        organization.status AS organization_status,
        membership.status AS membership_status,
        role.status AS role_status,
        assignment.scope_type,
        assignment.company_id,
        assignment.branch_id,
        role_permission.permission_code
      FROM organization_memberships AS membership
      JOIN users AS app_user ON app_user.id = membership.user_id
      JOIN organizations AS organization ON organization.id = membership.organization_id
      LEFT JOIN role_assignments AS assignment
        ON assignment.membership_id = membership.id
        AND assignment.organization_id = membership.organization_id
      LEFT JOIN roles AS role
        ON role.id = assignment.role_id
        AND role.organization_id = assignment.organization_id
      LEFT JOIN role_permissions AS role_permission
        ON role_permission.role_id = role.id
        AND role_permission.organization_id = role.organization_id
      WHERE membership.user_id = $1::uuid
        AND membership.organization_id = $2::uuid
    `,
    [userId, organizationId],
  );

  const first = result.rows[0];
  if (!first) {
    return null;
  }
  if (
    first.user_status !== "ACTIVE" ||
    first.organization_status !== "ACTIVE" ||
    first.membership_status !== "ACTIVE"
  ) {
    return null;
  }

  const grants = new Map<string, AccessGrant>();
  for (const row of result.rows) {
    if (
      row.role_status !== "ACTIVE" ||
      row.permission_code === null ||
      row.scope_type === null ||
      !hasValidScopeShape(row)
    ) {
      continue;
    }
    const grant: AccessGrant = {
      organizationId: row.organization_id,
      permissionCode: row.permission_code,
      scopeType: row.scope_type,
      companyId: row.company_id,
      branchId: row.branch_id,
    };
    grants.set(
      `${grant.permissionCode}:${grant.scopeType}:${grant.companyId ?? ""}:${grant.branchId ?? ""}`,
      grant,
    );
  }

  return {
    userId: first.user_id,
    organizationId: first.organization_id,
    membershipId: first.membership_id,
    grants: [...grants.values()],
  };
}

/**
 * Fails closed across tenants and scopes. `target` must describe a resource already loaded through
 * a tenant-scoped repository; never build it from IDs supplied directly by the browser.
 */
export function hasPermission(
  context: AccessContext,
  permissionCode: string,
  target: AccessTarget,
): boolean {
  if (target.organizationId !== context.organizationId) {
    return false;
  }
  if (target.branchId && !target.companyId) {
    return false;
  }

  return context.grants.some((grant) => {
    if (grant.organizationId !== context.organizationId || grant.permissionCode !== permissionCode) {
      return false;
    }
    if (grant.scopeType === "ORGANIZATION") {
      return grant.companyId === null && grant.branchId === null;
    }
    if (grant.scopeType === "COMPANY") {
      return (
        grant.companyId !== null &&
        grant.branchId === null &&
        target.companyId === grant.companyId
      );
    }
    return (
      grant.scopeType === "BRANCH" &&
      grant.companyId !== null &&
      grant.branchId !== null &&
      target.companyId === grant.companyId &&
      target.branchId === grant.branchId
    );
  });
}
