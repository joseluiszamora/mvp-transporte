import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { tenantAdminPermissionCodes } from "../access/permission-catalog.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { createOpaqueToken, hashOpaqueToken } from "../auth/auth-crypto.ts";
import { AuthServiceError, requireEmailAddress, type AuthSettings, type AuthenticatedSession } from "../auth/auth-service.ts";
import { enqueueEmail } from "../email/outbox-service.ts";

function requiredText(value: string, maximumLength: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximumLength || /[\r\n\0]/u.test(normalized)) {
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

function getEmailConfiguration(settings: AuthSettings): { encryptionKey: string; webUrl: URL } {
  const encryptionKey = settings.emailPayloadEncryptionKey?.trim();
  const webUrlValue = settings.publicWebUrl?.trim();
  if (!encryptionKey || !webUrlValue) {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  let webUrl: URL;
  try {
    webUrl = new URL(webUrlValue);
  } catch {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  if (
    !["http:", "https:"].includes(webUrl.protocol) ||
    webUrl.username ||
    webUrl.password ||
    (settings.secureCookies && webUrl.protocol !== "https:")
  ) {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  return { encryptionKey, webUrl };
}

async function createActivationEmail(
  client: PoolClient,
  settings: AuthSettings,
  input: {
    userId: string;
    normalizedEmail: string;
    displayName: string;
    organizationId?: string;
    organizationName?: string;
    membershipId?: string;
  },
): Promise<string> {
  const { encryptionKey, webUrl } = getEmailConfiguration(settings);
  const rawToken = createOpaqueToken();
  const tokenId = randomUUID();
  const actionUrl = new URL("/activate", webUrl);
  actionUrl.searchParams.set("token", rawToken);
  await client.query(
    `INSERT INTO account_tokens (id, user_id, membership_id, purpose, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVATION', $4, CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
    [tokenId, input.userId, input.membershipId ?? null, hashOpaqueToken(rawToken)],
  );
  const templateCode = input.membershipId ? "account.membership_invitation" : "account.activation";
  const payload: Record<string, string> = input.membershipId
    ? {
        displayName: input.displayName,
        organizationName: input.organizationName ?? "",
        actionUrl: actionUrl.toString(),
      }
    : { displayName: input.displayName, actionUrl: actionUrl.toString() };
  const queued = await enqueueEmail(
    client,
    {
      organizationId: input.organizationId ?? null,
      templateCode,
      recipient: input.normalizedEmail,
      deduplicationKey: input.membershipId
        ? `membership-invitation:${input.membershipId}:${tokenId}`
        : `platform-bootstrap:${input.userId}:${tokenId}`,
      payload,
    },
    encryptionKey,
  );
  return queued.id;
}

export async function bootstrapPlatformAdmin(
  database: Pool,
  settings: AuthSettings,
  input: { email: string; displayName: string; requestId: string },
): Promise<{ userId: string; emailOutboxId: string }> {
  const email = requireEmailAddress(input.email);
  const displayName = requiredText(input.displayName, 160);
  getEmailConfiguration(settings);
  return transaction(database, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["mvp-transporte:platform-admin-bootstrap"]);
    const existingAdmin = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE platform_role = 'PLATFORM_ADMIN' LIMIT 1 FOR UPDATE",
    );
    if (existingAdmin.rows[0]) {
      throw new AuthServiceError(409, "PLATFORM_ADMIN_EXISTS", "Ya existe un administrador de plataforma.");
    }
    const existingEmail = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE normalized_email = $1",
      [email],
    );
    if (existingEmail.rows[0]) {
      throw new AuthServiceError(409, "EMAIL_ALREADY_REGISTERED", "No se pudo crear el administrador solicitado.");
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (id, normalized_email, display_name, status, platform_role, updated_at)
       VALUES ($1::uuid, $2, $3, 'PENDING_ACTIVATION', 'PLATFORM_ADMIN', CURRENT_TIMESTAMP)
       RETURNING id`,
      [randomUUID(), email, displayName],
    );
    const userId = created.rows[0]?.id;
    if (!userId) {
      throw new Error("PLATFORM_ADMIN_NOT_CREATED");
    }
    const emailOutboxId = await createActivationEmail(client, settings, {
      userId,
      normalizedEmail: email,
      displayName,
    });
    await appendAuditEvent(client, {
      actor: { type: "SYSTEM" },
      action: "PLATFORM_ADMIN_BOOTSTRAPPED",
      resourceType: "User",
      resourceId: userId,
      requestId: input.requestId,
      after: { status: "PENDING_ACTIVATION" },
    });
    return { userId, emailOutboxId };
  });
}

export async function createOrganizationWithAdmin(
  database: Pool,
  settings: AuthSettings,
  session: AuthenticatedSession,
  input: { organizationName: string; adminEmail: string; adminDisplayName: string; requestId: string },
): Promise<{ id: string; name: string; adminInvitationQueued: true }> {
  if (session.platformRole !== "PLATFORM_ADMIN") {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
  const organizationName = requiredText(input.organizationName, 160);
  const adminEmail = requireEmailAddress(input.adminEmail);
  const adminDisplayName = requiredText(input.adminDisplayName, 160);
  getEmailConfiguration(settings);

  return transaction(database, async (client) => {
    const organizationId = randomUUID();
    await client.query(
      `INSERT INTO organizations (id, name, status, updated_at)
       VALUES ($1::uuid, $2, 'ACTIVE', CURRENT_TIMESTAMP)`,
      [organizationId, organizationName],
    );
    const roleId = randomUUID();
    await client.query(
      `INSERT INTO roles (id, organization_id, code, name, status, updated_at)
       VALUES ($1::uuid, $2::uuid, 'admin', 'Administrador', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [roleId, organizationId],
    );
    for (const permissionCode of tenantAdminPermissionCodes) {
      await client.query(
        `INSERT INTO role_permissions (organization_id, role_id, permission_code)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [organizationId, roleId, permissionCode],
      );
    }
    const insertedUser = await client.query<{ id: string; normalized_email: string; display_name: string; status: string }>(
      `INSERT INTO users (id, normalized_email, display_name, status, updated_at)
       VALUES ($1::uuid, $2, $3, 'PENDING_ACTIVATION', CURRENT_TIMESTAMP)
       ON CONFLICT (normalized_email) DO NOTHING
       RETURNING id, normalized_email, display_name, status`,
      [randomUUID(), adminEmail, adminDisplayName],
    );
    const user = insertedUser.rows[0] ?? (await client.query<{ id: string; normalized_email: string; display_name: string; status: string }>(
      `SELECT id, normalized_email, display_name, status
       FROM users WHERE normalized_email = $1 FOR UPDATE`,
      [adminEmail],
    )).rows[0];
    if (!user) {
      throw new Error("TENANT_ADMIN_NOT_FOUND");
    }
    const membershipId = randomUUID();
    await client.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'INVITED', CURRENT_TIMESTAMP)`,
      [membershipId, organizationId, user.id],
    );
    await client.query(
      `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION')`,
      [randomUUID(), organizationId, membershipId, roleId],
    );
    await createActivationEmail(client, settings, {
      userId: user.id,
      normalizedEmail: user.normalized_email,
      displayName: user.display_name,
      organizationId,
      organizationName,
      membershipId,
    });
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId,
      action: "ORGANIZATION_CREATED",
      resourceType: "Organization",
      resourceId: organizationId,
      requestId: input.requestId,
      after: { name: organizationName, status: "ACTIVE" },
    });
    return { id: organizationId, name: organizationName, adminInvitationQueued: true };
  });
}
