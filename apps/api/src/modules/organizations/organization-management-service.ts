import type { Pool, PoolClient, QueryResultRow } from "pg";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

type OrganizationStatus = "ACTIVE" | "SUSPENDED";

interface OrganizationRow extends QueryResultRow {
  id: string;
  name: string;
  status: OrganizationStatus;
  created_at: Date;
  updated_at: Date;
}

function requirePlatformAdmin(session: AuthenticatedSession): void {
  if (session.platformRole !== "PLATFORM_ADMIN") {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

function requiredName(value: string): string {
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 160 || /[\r\n\0]/u.test(name)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return name;
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

export async function listPlatformOrganizations(
  database: Pick<Pool, "query">,
  session: AuthenticatedSession,
  input: { limit: number; offset: number; search?: string; status?: OrganizationStatus },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  requirePlatformAdmin(session);
  const search = input.search?.trim();
  if (search && (search.length > 160 || /[\0]/u.test(search))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  const filters = ["($1::text IS NULL OR organization.name ILIKE '%' || $1 || '%')", "($2::\"OrganizationStatus\" IS NULL OR organization.status = $2)"];
  const values = [search || null, input.status ?? null];
  const [totalResult, rows] = await Promise.all([
    database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM organizations AS organization WHERE ${filters.join(" AND ")}`,
      values,
    ),
    database.query<OrganizationRow>(
      `SELECT organization.id, organization.name, organization.status, organization.created_at, organization.updated_at
       FROM organizations AS organization
       WHERE ${filters.join(" AND ")}
       ORDER BY organization.created_at DESC, organization.id
       LIMIT $3 OFFSET $4`,
      [...values, input.limit, input.offset],
    ),
  ]);
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    total: totalResult.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function updatePlatformOrganization(
  database: Pool,
  session: AuthenticatedSession,
  input: { organizationId: string; name?: string; status?: OrganizationStatus; requestId: string },
): Promise<{ id: string; name: string; status: OrganizationStatus }> {
  requirePlatformAdmin(session);
  const name = input.name === undefined ? undefined : requiredName(input.name);
  if (name === undefined && input.status === undefined) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }

  return transaction(database, async (client) => {
    const result = await client.query<OrganizationRow>(
      `SELECT id, name, status, created_at, updated_at FROM organizations
       WHERE id = $1::uuid FOR UPDATE`,
      [input.organizationId],
    );
    const current = result.rows[0];
    if (!current) {
      throw new AuthServiceError(404, "ORGANIZATION_NOT_FOUND", "Organización no disponible.");
    }
    const nextName = name ?? current.name;
    const nextStatus = input.status ?? current.status;
    await client.query(
      `UPDATE organizations SET name = $2, status = $3::"OrganizationStatus", updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid`,
      [current.id, nextName, nextStatus],
    );
    if (name !== undefined || nextStatus !== current.status) {
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: session.userId },
        action: nextStatus !== current.status
          ? nextStatus === "ACTIVE" ? "ORGANIZATION_ACTIVATED" : "ORGANIZATION_DEACTIVATED"
          : "ORGANIZATION_UPDATED",
        resourceType: "Organization",
        resourceId: current.id,
        requestId: input.requestId,
        before: { name: current.name, status: current.status },
        after: { name: nextName, status: nextStatus },
      });
    }
    return { id: current.id, name: nextName, status: nextStatus };
  });
}
