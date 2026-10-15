import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { enqueueEmail } from "../email/outbox-service.ts";
import { hashOpaqueToken, createOpaqueToken } from "../auth/auth-crypto.ts";
import { AuthServiceError, requireEmailAddress, type AuthSettings, type AuthenticatedSession } from "../auth/auth-service.ts";

interface UserMembershipRow extends QueryResultRow {
  id: string;
  normalized_email: string;
  display_name: string;
  user_status: string;
  membership_id: string;
  membership_status: string;
  created_at: Date;
}

function requiredName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 160 || /[\r\n\0]/u.test(normalized)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return normalized;
}

async function transaction<T>(database: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertPermission(
  database: Pool,
  session: AuthenticatedSession,
  permissionCode: string,
): Promise<void> {
  if (!session.organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  const context = await resolveAccessContext(database, session.userId, session.organizationId);
  if (!context || !hasPermission(context, permissionCode, { organizationId: session.organizationId })) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

export async function listOrganizationUsers(
  database: Pool,
  session: AuthenticatedSession,
  input: { limit: number; offset: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  await assertPermission(database, session, "users.read");
  const organizationId = session.organizationId;
  if (!organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  const [totalResult, rows] = await Promise.all([
    database.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM organization_memberships WHERE organization_id = $1::uuid",
      [organizationId],
    ),
    database.query<UserMembershipRow>(
      `SELECT app_user.id, app_user.normalized_email, app_user.display_name,
         app_user.status AS user_status, membership.id AS membership_id,
         membership.status AS membership_status, membership.created_at
       FROM organization_memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.organization_id = $1::uuid
       ORDER BY app_user.display_name, app_user.normalized_email
       LIMIT $2 OFFSET $3`,
      [organizationId, input.limit, input.offset],
    ),
  ]);
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      email: row.normalized_email,
      displayName: row.display_name,
      accountStatus: row.user_status,
      membershipId: row.membership_id,
      membershipStatus: row.membership_status,
      createdAt: row.created_at.toISOString(),
    })),
    total: totalResult.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function inviteOrganizationUser(
  database: Pool,
  settings: AuthSettings,
  session: AuthenticatedSession,
  input: { email: string; displayName: string; requestId: string },
): Promise<void> {
  await assertPermission(database, session, "users.create");
  const organizationId = session.organizationId;
  if (!organizationId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa.");
  }
  const email = requireEmailAddress(input.email);
  const displayName = requiredName(input.displayName);

  await transaction(database, async (client) => {
    const organization = await client.query<{ id: string; name: string; status: string }>(
      "SELECT id, name, status FROM organizations WHERE id = $1::uuid",
      [organizationId],
    );
    const tenant = organization.rows[0];
    if (tenant?.status !== "ACTIVE") {
      throw new AuthServiceError(404, "ORGANIZATION_NOT_FOUND", "Organización no disponible.");
    }
    const insertedUser = await client.query<UserMembershipRow>(
      `INSERT INTO users (id, normalized_email, display_name, status, updated_at)
       VALUES ($1::uuid, $2, $3, 'PENDING_ACTIVATION', CURRENT_TIMESTAMP)
       ON CONFLICT (normalized_email) DO NOTHING
       RETURNING id, normalized_email, display_name, status AS user_status,
         NULL::uuid AS membership_id, NULL::"MembershipStatus" AS membership_status, CURRENT_TIMESTAMP AS created_at`,
      [randomUUID(), email, displayName],
    );
    const user = insertedUser.rows[0] ?? (await client.query<UserMembershipRow>(
      `SELECT id, normalized_email, display_name, status AS user_status,
         NULL::uuid AS membership_id, NULL::"MembershipStatus" AS membership_status, created_at
       FROM users WHERE normalized_email = $1`,
      [email],
    )).rows[0];
    if (!user) {
      throw new Error("INVITED_USER_NOT_FOUND");
    }
    const membershipResult = await client.query<{ id: string }>(
      `INSERT INTO organization_memberships (id, organization_id, user_id, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'INVITED', CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, user_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), organizationId, user.id],
    );
    const membershipId = membershipResult.rows[0]?.id;
    if (!membershipId) {
      return;
    }
    const rawToken = createOpaqueToken();
    const tokenResult = await client.query<{ id: string }>(
      `INSERT INTO account_tokens (id, user_id, membership_id, purpose, token_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVATION', $4, CURRENT_TIMESTAMP + INTERVAL '24 hours')
       RETURNING id`,
      [randomUUID(), user.id, membershipId, hashOpaqueToken(rawToken)],
    );
    const tokenId = tokenResult.rows[0]?.id;
    if (!tokenId) {
      throw new Error("INVITATION_TOKEN_NOT_CREATED");
    }
    const encryptionKey = settings.emailPayloadEncryptionKey?.trim();
    const webUrlValue = settings.publicWebUrl?.trim();
    if (!encryptionKey || !webUrlValue) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    const webUrl = new URL(webUrlValue);
    if (!["http:", "https:"].includes(webUrl.protocol) || (settings.secureCookies && webUrl.protocol !== "https:")) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    const actionUrl = new URL("/activate", webUrl);
    actionUrl.searchParams.set("token", rawToken);
    await enqueueEmail(
      client,
      {
        organizationId,
        templateCode: "account.membership_invitation",
        recipient: user.normalized_email,
        deduplicationKey: `membership-invitation:${membershipId}:${tokenId}`,
        payload: {
          displayName: user.display_name,
          organizationName: tenant.name,
          actionUrl: actionUrl.toString(),
        },
      },
      encryptionKey,
    );
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId,
      action: "USER_INVITED",
      resourceType: "OrganizationMembership",
      resourceId: membershipId,
      requestId: input.requestId,
      after: { status: "INVITED" },
    });
  });
}
