import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { resolveAccessContext } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { enqueueEmail } from "../email/outbox-service.ts";
import {
  createAccessToken,
  createCsrfToken,
  createDummyPasswordHash,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  parseAccessTokenSecret,
  verifyAccessToken,
  verifyPassword,
} from "./auth-crypto.ts";

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const recoveryLifetimeMs = 30 * 60 * 1_000;
const dummyPasswordHash = createDummyPasswordHash();

export interface AuthSettings {
  accessTokenSecret?: string;
  emailPayloadEncryptionKey?: string;
  smtpSettingsEncryptionKey?: string;
  publicWebUrl?: string;
  secureCookies: boolean;
}

export interface AuthenticatedSession {
  userId: string;
  sessionId: string;
  selectedMembershipId: string | null;
  organizationId: string | null;
  platformRole: string | null;
}

export class AuthServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    publicMessage: string,
    retryAfterSeconds?: number,
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface UserPasswordRow extends QueryResultRow {
  id: string;
  display_name: string;
  normalized_email: string;
  password_hash: string | null;
  status: string;
  platform_role: string | null;
}

interface MembershipOption extends QueryResultRow {
  membership_id: string;
  organization_id: string;
  organization_name: string;
}

interface TransactionContext {
  database: Pool;
  requestId: string;
  settings: AuthSettings;
}

export interface AuthCredentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
  refreshToken: string;
  user: { id: string; displayName: string; email: string; platformAdmin: boolean };
  organizations: Array<{ id: string; membershipId: string; name: string }>;
  selectedOrganizationId: string | null;
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

function requireDatabase(database: Pool | undefined): Pool {
  if (!database) {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  return database;
}

export function requireEmailAddress(value: string): string {
  try {
    return normalizeEmail(value);
  } catch {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
}

function requireAccessSecret(settings: AuthSettings): Uint8Array {
  try {
    return parseAccessTokenSecret(settings.accessTokenSecret);
  } catch {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
}

async function requirePasswordHash(value: string): Promise<string> {
  try {
    return await hashPassword(value);
  } catch {
    throw new AuthServiceError(400, "INVALID_PASSWORD", "La contraseña debe tener al menos 12 caracteres.");
  }
}

function requireEmailSettings(settings: AuthSettings): { encryptionKey: string; webUrl: URL } {
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
    webUrl.username.length > 0 ||
    webUrl.password.length > 0 ||
    (settings.secureCookies && webUrl.protocol !== "https:")
  ) {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  return { encryptionKey, webUrl };
}

function tokenActionUrl(webUrl: URL, path: string, token: string): string {
  const target = new URL(path, webUrl);
  target.searchParams.set("token", token);
  return target.toString();
}

async function createAccountToken(
  client: PoolClient,
  userId: string,
  purpose: "ACTIVATION" | "PASSWORD_RECOVERY",
  membershipId: string | null,
  expiresAt: Date,
): Promise<{ id: string; rawToken: string }> {
  const rawToken = createOpaqueToken();
  const result = await client.query<{ id: string }>(
    `INSERT INTO account_tokens (id, user_id, membership_id, purpose, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"AccountTokenPurpose", $5, $6::timestamptz)
     RETURNING id`,
    [randomUUID(), userId, membershipId, purpose, hashOpaqueToken(rawToken), expiresAt],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("ACCOUNT_TOKEN_NOT_CREATED");
  }
  return { id, rawToken };
}

async function enqueueAccountMessage(
  client: PoolClient,
  settings: AuthSettings,
  input: {
    organizationId?: string | null;
    templateCode: string;
    recipient: string;
    displayName: string;
    organizationName?: string;
    path: string;
    rawToken: string;
    deduplicationKey: string;
  },
): Promise<void> {
  const { encryptionKey, webUrl } = requireEmailSettings(settings);
  await enqueueEmail(
    client,
    {
      organizationId: input.organizationId,
      templateCode: input.templateCode,
      recipient: input.recipient,
      deduplicationKey: input.deduplicationKey,
      payload: {
        displayName: input.displayName,
        actionUrl: tokenActionUrl(webUrl, input.path, input.rawToken),
        ...(input.organizationName ? { organizationName: input.organizationName } : {}),
      },
    },
    encryptionKey,
  );
}

async function listActiveMemberships(database: Pick<Pool, "query">, userId: string): Promise<MembershipOption[]> {
  const result = await database.query<MembershipOption>(
    `SELECT membership.id AS membership_id, organization.id AS organization_id,
       organization.name AS organization_name
     FROM organization_memberships AS membership
     JOIN organizations AS organization ON organization.id = membership.organization_id
     WHERE membership.user_id = $1::uuid
       AND membership.status = 'ACTIVE' AND organization.status = 'ACTIVE'
     ORDER BY organization.name, organization.id`,
    [userId],
  );
  return result.rows;
}

async function issueSession(
  client: PoolClient,
  user: UserPasswordRow,
  membership: MembershipOption | null,
  context: TransactionContext,
): Promise<AuthCredentials> {
  const sessionId = randomUUID();
  const refreshTokenId = randomUUID();
  const refreshToken = createOpaqueToken();
  const csrfToken = createCsrfToken();
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + sessionLifetimeMs);
  const selectedMembershipId = membership?.membership_id ?? null;

  await client.query(
    "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1::uuid AND revoked_at IS NULL",
    [user.id],
  );
  await client.query(
    `INSERT INTO sessions (id, user_id, selected_membership_id, expires_at, metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::jsonb)`,
    [sessionId, user.id, selectedMembershipId, sessionExpiresAt, JSON.stringify({ client: "web" })],
  );
  await client.query(
    `INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz)`,
    [refreshTokenId, sessionId, hashOpaqueToken(refreshToken), sessionExpiresAt],
  );
  await appendAuditEvent(client, {
    actor: { type: "USER", userId: user.id },
    organizationId: membership?.organization_id,
    action: "AUTH_LOGIN",
    resourceType: "Session",
    resourceId: sessionId,
    requestId: context.requestId,
    after: { expiresAt: sessionExpiresAt, selectedMembershipId },
  });
  const secret = requireAccessSecret(context.settings);
  const access = await createAccessToken(
    secret,
    { userId: user.id, sessionId, selectedMembershipId },
    sessionExpiresAt,
    now,
  );
  const organizations = await listActiveMemberships(context.database, user.id);
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    csrfToken,
    refreshToken,
    user: {
      id: user.id,
      displayName: user.display_name,
      email: user.normalized_email,
      platformAdmin: user.platform_role === "PLATFORM_ADMIN",
    },
    organizations: organizations.map((item) => ({
      id: item.organization_id,
      membershipId: item.membership_id,
      name: item.organization_name,
    })),
    selectedOrganizationId: membership?.organization_id ?? null,
  };
}

export async function login(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  input: { email: string; password: string; requestId: string },
): Promise<AuthCredentials> {
  const database = requireDatabase(databaseInput);
  requireAccessSecret(settings);
  const normalizedEmail = requireEmailAddress(input.email);
  if (Buffer.byteLength(input.password, "utf8") > 1_024) {
    throw new AuthServiceError(401, "INVALID_CREDENTIALS", "Correo o contraseña no válidos.");
  }
  const found = await database.query<UserPasswordRow>(
    `SELECT id, normalized_email, display_name, password_hash, status, platform_role
     FROM users WHERE normalized_email = $1`,
    [normalizedEmail],
  );
  const candidate = found.rows[0];
  const encodedHash = candidate?.password_hash ?? (await dummyPasswordHash);
  const matches = await verifyPassword(input.password, encodedHash);
  if (candidate?.status !== "ACTIVE" || !candidate.password_hash || !matches) {
    throw new AuthServiceError(401, "INVALID_CREDENTIALS", "Correo o contraseña no válidos.");
  }

  return inTransaction(database, async (client) => {
    const locked = await client.query<UserPasswordRow>(
      `SELECT id, normalized_email, display_name, password_hash, status, platform_role
       FROM users WHERE id = $1::uuid FOR UPDATE`,
      [candidate.id],
    );
    const current = locked.rows[0];
    if (
      current?.status !== "ACTIVE" ||
      !current.password_hash ||
      current.password_hash !== candidate.password_hash
    ) {
      throw new AuthServiceError(401, "INVALID_CREDENTIALS", "Correo o contraseña no válidos.");
    }
    const memberships = await listActiveMemberships(client, current.id);
    return issueSession(client, current, memberships[0] ?? null, {
      database,
      requestId: input.requestId,
      settings,
    });
  });
}

export async function authenticateAccessToken(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  token: string,
): Promise<AuthenticatedSession | null> {
  const database = requireDatabase(databaseInput);
  const secret = requireAccessSecret(settings);
  const claims = await verifyAccessToken(token, secret);
  if (!claims) {
    return null;
  }
  const result = await database.query<{
    session_id: string;
    user_id: string;
    selected_membership_id: string | null;
    organization_id: string | null;
    platform_role: string | null;
    user_status: string;
    membership_status: string | null;
    organization_status: string | null;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT session.id AS session_id, session.user_id, session.selected_membership_id,
       membership.organization_id, app_user.platform_role, app_user.status AS user_status,
       membership.status AS membership_status, organization.status AS organization_status,
       session.expires_at, session.revoked_at
     FROM sessions AS session
     JOIN users AS app_user ON app_user.id = session.user_id
     LEFT JOIN organization_memberships AS membership
       ON membership.id = session.selected_membership_id AND membership.user_id = session.user_id
     LEFT JOIN organizations AS organization ON organization.id = membership.organization_id
     WHERE session.id = $1::uuid AND session.user_id = $2::uuid`,
    [claims.sessionId, claims.userId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.revoked_at ||
    row.expires_at.getTime() <= Date.now() ||
    row.user_status !== "ACTIVE" ||
    row.selected_membership_id !== claims.selectedMembershipId ||
    (row.selected_membership_id !== null &&
      (row.membership_status !== "ACTIVE" || row.organization_status !== "ACTIVE"))
  ) {
    return null;
  }
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    selectedMembershipId: row.selected_membership_id,
    organizationId: row.organization_id,
    platformRole: row.platform_role,
  };
}

export async function getCurrentUser(
  database: Pool,
  session: AuthenticatedSession,
): Promise<{
  id: string;
  email: string;
  displayName: string;
  platformAdmin: boolean;
  selectedOrganizationId: string | null;
  permissions: string[];
  organizations: Array<{ id: string; membershipId: string; name: string }>;
}> {
  const result = await database.query<UserPasswordRow>(
    `SELECT id, normalized_email, display_name, password_hash, status, platform_role
     FROM users WHERE id = $1::uuid AND status = 'ACTIVE'`,
    [session.userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AuthServiceError(401, "UNAUTHENTICATED", "La sesión ya no está disponible.");
  }
  const organizations = await listActiveMemberships(database, session.userId);
  const accessContext = session.organizationId
    ? await resolveAccessContext(database, session.userId, session.organizationId)
    : null;
  return {
    id: user.id,
    email: user.normalized_email,
    displayName: user.display_name,
    platformAdmin: user.platform_role === "PLATFORM_ADMIN",
    selectedOrganizationId: session.organizationId,
    permissions: [...new Set(accessContext?.grants.map((grant) => grant.permissionCode) ?? [])],
    organizations: organizations.map((item) => ({
      id: item.organization_id,
      membershipId: item.membership_id,
      name: item.organization_name,
    })),
  };
}

export async function rotateRefreshToken(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  rawToken: string | undefined,
  requestId: string,
): Promise<AuthCredentials> {
  const database = requireDatabase(databaseInput);
  const secret = requireAccessSecret(settings);
  if (!rawToken) {
    throw new AuthServiceError(401, "INVALID_SESSION", "La sesión ya no está disponible.");
  }
  const result = await inTransaction(database, async (client) => {
    const tokenResult = await client.query<{
      id: string;
      session_id: string;
      user_id: string;
      selected_membership_id: string | null;
      expires_at: Date;
      consumed_at: Date | null;
      session_revoked_at: Date | null;
      user_status: string;
      platform_role: string | null;
      normalized_email: string;
      display_name: string;
      password_hash: string | null;
    }>(
      `SELECT refresh.id, refresh.session_id, refresh.consumed_at, refresh.expires_at AS token_expires_at,
         session.user_id, session.selected_membership_id, session.expires_at,
         session.revoked_at AS session_revoked_at, app_user.status AS user_status,
         app_user.platform_role, app_user.normalized_email, app_user.display_name, app_user.password_hash
       FROM refresh_tokens AS refresh
       JOIN sessions AS session ON session.id = refresh.session_id
       JOIN users AS app_user ON app_user.id = session.user_id
       WHERE refresh.token_hash = $1
       FOR UPDATE OF refresh`,
      [hashOpaqueToken(rawToken)],
    );
    const token = tokenResult.rows[0];
    if (!token) {
      return { error: "INVALID_SESSION" as const };
    }
    await client.query("SELECT id FROM sessions WHERE id = $1::uuid FOR UPDATE", [token.session_id]);
    if (token.consumed_at) {
      if (!token.session_revoked_at) {
        await client.query(
          "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND revoked_at IS NULL",
          [token.session_id],
        );
        await appendAuditEvent(client, {
          actor: { type: "USER", userId: token.user_id },
          organizationId: null,
          action: "AUTH_REFRESH_REPLAY_DETECTED",
          resourceType: "Session",
          resourceId: token.session_id,
          requestId,
        });
      }
      return { error: "REFRESH_REPLAY" as const };
    }
    if (
      token.session_revoked_at ||
      token.expires_at.getTime() <= Date.now() ||
      token.user_status !== "ACTIVE"
    ) {
      return { error: "INVALID_SESSION" as const };
    }

    let selectedMembershipId = token.selected_membership_id;
    let selectedOrganizationId: string | null = null;
    if (selectedMembershipId) {
      const membership = await client.query<{ organization_id: string }>(
        `SELECT membership.organization_id
         FROM organization_memberships AS membership
         JOIN organizations AS organization ON organization.id = membership.organization_id
         WHERE membership.id = $1::uuid AND membership.user_id = $2::uuid
           AND membership.status = 'ACTIVE' AND organization.status = 'ACTIVE'`,
        [selectedMembershipId, token.user_id],
      );
      if (membership.rows[0]) {
        selectedOrganizationId = membership.rows[0].organization_id;
      } else {
        selectedMembershipId = null;
        await client.query(
          "UPDATE sessions SET selected_membership_id = NULL WHERE id = $1::uuid",
          [token.session_id],
        );
      }
    }
    const nextToken = createOpaqueToken();
    const nextTokenId = randomUUID();
    await client.query(
      `INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz)`,
      [nextTokenId, token.session_id, hashOpaqueToken(nextToken), token.expires_at],
    );
    await client.query(
      `UPDATE refresh_tokens SET consumed_at = CURRENT_TIMESTAMP, successor_id = $2::uuid
       WHERE id = $1::uuid`,
      [token.id, nextTokenId],
    );
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: token.user_id },
      organizationId: selectedOrganizationId,
      action: "AUTH_REFRESH",
      resourceType: "Session",
      resourceId: token.session_id,
      requestId,
    });
    const access = await createAccessToken(
      secret,
      { userId: token.user_id, sessionId: token.session_id, selectedMembershipId },
      token.expires_at,
    );
    const organizations = await listActiveMemberships(client, token.user_id);
    return {
      credentials: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        csrfToken: createCsrfToken(),
        refreshToken: nextToken,
        user: {
          id: token.user_id,
          displayName: token.display_name,
          email: token.normalized_email,
          platformAdmin: token.platform_role === "PLATFORM_ADMIN",
        },
        organizations: organizations.map((item) => ({
          id: item.organization_id,
          membershipId: item.membership_id,
          name: item.organization_name,
        })),
        selectedOrganizationId,
      } satisfies AuthCredentials,
    };
  });
  if ("error" in result && result.error) {
    throw new AuthServiceError(401, result.error, "La sesión ya no está disponible.");
  }
  if (!("credentials" in result)) {
    throw new AuthServiceError(401, "INVALID_SESSION", "La sesión ya no está disponible.");
  }
  return result.credentials;
}

export async function logout(
  databaseInput: Pool | undefined,
  rawToken: string | undefined,
  requestId: string,
  currentSession?: AuthenticatedSession | null,
): Promise<void> {
  const database = requireDatabase(databaseInput);
  if (!rawToken && !currentSession) {
    return;
  }
  await inTransaction(database, async (client) => {
    const found = rawToken
      ? await client.query<{ session_id: string; user_id: string; organization_id: string | null }>(
          `SELECT refresh.session_id, session.user_id, membership.organization_id
           FROM refresh_tokens AS refresh
           JOIN sessions AS session ON session.id = refresh.session_id
           LEFT JOIN organization_memberships AS membership
             ON membership.id = session.selected_membership_id AND membership.user_id = session.user_id
           WHERE refresh.token_hash = $1 FOR UPDATE OF refresh`,
          [hashOpaqueToken(rawToken)],
        )
      : { rows: [] };
    const token = found.rows[0] ?? (currentSession
      ? (await client.query<{ session_id: string; user_id: string; organization_id: string | null }>(
          `SELECT session.id AS session_id, session.user_id, membership.organization_id
           FROM sessions AS session
           LEFT JOIN organization_memberships AS membership
             ON membership.id = session.selected_membership_id AND membership.user_id = session.user_id
           WHERE session.id = $1::uuid AND session.user_id = $2::uuid`,
          [currentSession.sessionId, currentSession.userId],
        )).rows[0]
      : undefined);
    if (!token) {
      return;
    }
    await client.query("SELECT id FROM sessions WHERE id = $1::uuid FOR UPDATE", [token.session_id]);
    const revoked = await client.query(
      `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid AND revoked_at IS NULL RETURNING id`,
      [token.session_id],
    );
    if (revoked.rowCount) {
      await appendAuditEvent(client, {
        actor: { type: "USER", userId: token.user_id },
        organizationId: token.organization_id,
        action: "AUTH_LOGOUT",
        resourceType: "Session",
        resourceId: token.session_id,
        requestId,
      });
    }
  });
}

function isSafeCsrfMatch(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken || !/^[a-f0-9]{64}$/u.test(cookieToken) || !/^[a-f0-9]{64}$/u.test(headerToken)) {
    return false;
  }
  const cookieBytes = Buffer.from(cookieToken, "hex");
  const headerBytes = Buffer.from(headerToken, "hex");
  return cookieBytes.byteLength === headerBytes.byteLength && timingSafeEqual(cookieBytes, headerBytes);
}

export function validateCsrfPair(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  return isSafeCsrfMatch(cookieToken, headerToken);
}

export async function inspectAccountToken(
  databaseInput: Pool | undefined,
  rawToken: string,
): Promise<{ purpose: "PLATFORM_ACTIVATION" | "MEMBERSHIP_INVITATION"; displayName: string; organizationName: string | null; requiresPassword: boolean }> {
  const database = requireDatabase(databaseInput);
  const result = await database.query<{
    purpose: "ACTIVATION" | "PASSWORD_RECOVERY";
    membership_id: string | null;
    display_name: string;
    organization_name: string | null;
    organization_status: string | null;
    user_status: string;
    platform_role: string | null;
    membership_status: string | null;
  }>(
    `SELECT account_token.purpose, account_token.membership_id, app_user.display_name,
       organization.name AS organization_name, organization.status AS organization_status,
       app_user.status AS user_status, app_user.platform_role,
       membership.status AS membership_status
     FROM account_tokens AS account_token
     JOIN users AS app_user ON app_user.id = account_token.user_id
     LEFT JOIN organization_memberships AS membership
       ON membership.id = account_token.membership_id AND membership.user_id = account_token.user_id
     LEFT JOIN organizations AS organization ON organization.id = membership.organization_id
     WHERE account_token.token_hash = $1 AND account_token.consumed_at IS NULL
       AND account_token.expires_at > CURRENT_TIMESTAMP`,
    [hashOpaqueToken(rawToken)],
  );
  const token = result.rows[0];
  if (
    !token ||
    token.user_status === "BLOCKED" ||
    token.purpose !== "ACTIVATION" ||
    (token.membership_id && (!token.membership_status || token.membership_status !== "INVITED" || token.organization_status !== "ACTIVE")) ||
    (!token.membership_id && (token.platform_role !== "PLATFORM_ADMIN" || token.user_status !== "PENDING_ACTIVATION"))
  ) {
    throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
  }
  return {
    purpose: token.membership_id ? "MEMBERSHIP_INVITATION" : "PLATFORM_ACTIVATION",
    displayName: token.display_name,
    organizationName: token.organization_name,
    requiresPassword: token.user_status === "PENDING_ACTIVATION",
  };
}

export async function completeAccountActivation(
  databaseInput: Pool | undefined,
  input: { token: string; password?: string; requestId: string },
): Promise<{ activated: boolean; organizationName: string | null }> {
  const database = requireDatabase(databaseInput);
  const passwordHash = input.password === undefined ? null : await requirePasswordHash(input.password);
  return inTransaction(database, async (client) => {
    const found = await client.query<{
      id: string;
      user_id: string;
      membership_id: string | null;
      purpose: "ACTIVATION" | "PASSWORD_RECOVERY";
      expires_at: Date;
    }>(
      `SELECT id, user_id, membership_id, purpose, expires_at
       FROM account_tokens WHERE token_hash = $1 AND consumed_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [hashOpaqueToken(input.token)],
    );
    const token = found.rows[0];
    if (token?.purpose !== "ACTIVATION") {
      throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
    }
    const userResult = await client.query<UserPasswordRow>(
      `SELECT id, normalized_email, display_name, password_hash, status, platform_role
       FROM users WHERE id = $1::uuid FOR UPDATE`,
      [token.user_id],
    );
    const user = userResult.rows[0];
    if (!user || user.status === "BLOCKED") {
      throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
    }

    let organizationName: string | null = null;
    if (token.membership_id) {
      const membershipResult = await client.query<{
        status: string;
        organization_id: string;
        organization_name: string;
        organization_status: string;
      }>(
        `SELECT membership.status, membership.organization_id, organization.name AS organization_name,
           organization.status AS organization_status
         FROM organization_memberships AS membership
         JOIN organizations AS organization ON organization.id = membership.organization_id
         WHERE membership.id = $1::uuid AND membership.user_id = $2::uuid FOR UPDATE OF membership`,
        [token.membership_id, token.user_id],
      );
      const membership = membershipResult.rows[0];
      if (membership?.status !== "INVITED" || membership.organization_status !== "ACTIVE") {
        throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
      }
      organizationName = membership.organization_name;
      if (user.status === "PENDING_ACTIVATION") {
        if (!passwordHash) {
          throw new AuthServiceError(400, "PASSWORD_REQUIRED", "Define una contraseña para activar tu cuenta.");
        }
        await client.query(
          `UPDATE users SET password_hash = $2, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid`,
          [user.id, passwordHash],
        );
        await client.query(
          `UPDATE account_tokens SET consumed_at = CURRENT_TIMESTAMP
           WHERE user_id = $1::uuid AND purpose = 'ACTIVATION' AND membership_id IS NULL
             AND consumed_at IS NULL`,
          [user.id],
        );
      } else if (user.status !== "ACTIVE") {
        throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
      }
      await client.query(
        `UPDATE organization_memberships SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        [token.membership_id],
      );
      await appendAuditEvent(client, {
        actor: { type: "SYSTEM" },
        organizationId: membership.organization_id,
        action: "MEMBERSHIP_ACTIVATED",
        resourceType: "OrganizationMembership",
        resourceId: token.membership_id,
        requestId: input.requestId,
      });
    } else {
      if (user.platform_role !== "PLATFORM_ADMIN" || user.status !== "PENDING_ACTIVATION" || !passwordHash) {
        throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
      }
      await client.query(
        `UPDATE users SET password_hash = $2, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        [user.id, passwordHash],
      );
      await client.query(
        `UPDATE account_tokens SET consumed_at = CURRENT_TIMESTAMP
         WHERE user_id = $1::uuid AND purpose = 'ACTIVATION' AND membership_id IS NULL
           AND consumed_at IS NULL`,
        [user.id],
      );
      await appendAuditEvent(client, {
        actor: { type: "SYSTEM" },
        action: "PLATFORM_ADMIN_ACTIVATED",
        resourceType: "User",
        resourceId: user.id,
        requestId: input.requestId,
      });
    }
    await client.query(
      "UPDATE account_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1::uuid",
      [token.id],
    );
    return { activated: true, organizationName };
  });
}

export async function requestPasswordRecovery(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  input: { email: string; requestId: string },
): Promise<void> {
  const database = requireDatabase(databaseInput);
  requireEmailSettings(settings);
  const email = requireEmailAddress(input.email);
  await inTransaction(database, async (client) => {
    const result = await client.query<UserPasswordRow>(
      `SELECT id, normalized_email, display_name, password_hash, status, platform_role
       FROM users WHERE normalized_email = $1 FOR UPDATE`,
      [email],
    );
    const user = result.rows[0];
    if (user?.status !== "ACTIVE" || !user.password_hash) {
      return;
    }
    const token = await createAccountToken(
      client,
      user.id,
      "PASSWORD_RECOVERY",
      null,
      new Date(Date.now() + recoveryLifetimeMs),
    );
    await enqueueAccountMessage(client, settings, {
      templateCode: "account.recovery",
      recipient: user.normalized_email,
      displayName: user.display_name,
      path: "/recover/complete",
      rawToken: token.rawToken,
      deduplicationKey: `account:recovery:${token.id}`,
    });
    await appendAuditEvent(client, {
      actor: { type: "SYSTEM" },
      action: "PASSWORD_RECOVERY_REQUESTED",
      resourceType: "AccountToken",
      resourceId: token.id,
      requestId: input.requestId,
    });
  });
}

export async function completePasswordRecovery(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  input: { token: string; password: string; requestId: string },
): Promise<void> {
  const database = requireDatabase(databaseInput);
  requireEmailSettings(settings);
  const passwordHash = await requirePasswordHash(input.password);
  await inTransaction(database, async (client) => {
    const tokenResult = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM account_tokens WHERE token_hash = $1
       AND purpose = 'PASSWORD_RECOVERY' AND membership_id IS NULL
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [hashOpaqueToken(input.token)],
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
    }
    const userResult = await client.query<UserPasswordRow>(
      `SELECT id, normalized_email, display_name, password_hash, status, platform_role
       FROM users WHERE id = $1::uuid FOR UPDATE`,
      [token.user_id],
    );
    const user = userResult.rows[0];
    if (user?.status !== "ACTIVE") {
      throw new AuthServiceError(400, "INVALID_ACCOUNT_TOKEN", "El enlace ya no es válido.");
    }
    await client.query(
      "UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid",
      [user.id, passwordHash],
    );
    await client.query(
      "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [user.id],
    );
    await client.query(
      "UPDATE account_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = $1::uuid AND purpose = 'PASSWORD_RECOVERY' AND consumed_at IS NULL",
      [user.id],
    );
    await appendAuditEvent(client, {
      actor: { type: "SYSTEM" },
      action: "PASSWORD_RECOVERED",
      resourceType: "User",
      resourceId: user.id,
      requestId: input.requestId,
    });
    const resetId = await enqueuePasswordChanged(client, user, settings);
    await appendAuditEvent(client, {
      actor: { type: "SYSTEM" },
      action: "PASSWORD_CHANGED_EMAIL_QUEUED",
      resourceType: "EmailOutbox",
      resourceId: resetId,
      requestId: input.requestId,
    });
  });
}

async function enqueuePasswordChanged(client: PoolClient, user: UserPasswordRow, settings: AuthSettings): Promise<string> {
  const { encryptionKey } = requireEmailSettings(settings);
  const result = await enqueueEmail(
    client,
    {
      templateCode: "account.password_changed",
      recipient: user.normalized_email,
      deduplicationKey: `account:password-changed:${randomUUID()}`,
      payload: { displayName: user.display_name, changedAt: new Date().toISOString() },
    },
    encryptionKey,
  );
  return result.id;
}

export async function selectOrganization(
  databaseInput: Pool | undefined,
  settings: AuthSettings,
  session: AuthenticatedSession,
  organizationId: string,
  requestId: string,
): Promise<{ accessToken: string; accessTokenExpiresAt: string; selectedOrganizationId: string }> {
  const database = requireDatabase(databaseInput);
  const secret = requireAccessSecret(settings);
  const selected = await inTransaction(database, async (client) => {
    await client.query("SELECT id FROM sessions WHERE id = $1::uuid AND user_id = $2::uuid FOR UPDATE", [session.sessionId, session.userId]);
    const found = await client.query<{ membership_id: string; organization_id: string; expires_at: Date }>(
      `SELECT membership.id AS membership_id, organization.id AS organization_id, session.expires_at
       FROM sessions AS session
       JOIN organization_memberships AS membership
         ON membership.user_id = session.user_id AND membership.organization_id = $3::uuid
       JOIN organizations AS organization ON organization.id = membership.organization_id
       WHERE session.id = $1::uuid AND session.user_id = $2::uuid
         AND session.revoked_at IS NULL AND session.expires_at > CURRENT_TIMESTAMP
         AND membership.status = 'ACTIVE' AND organization.status = 'ACTIVE'`,
      [session.sessionId, session.userId, organizationId],
    );
    const row = found.rows[0];
    if (!row) {
      throw new AuthServiceError(404, "ORGANIZATION_NOT_FOUND", "Organización no disponible.");
    }
    await client.query(
      "UPDATE sessions SET selected_membership_id = $2::uuid WHERE id = $1::uuid",
      [session.sessionId, row.membership_id],
    );
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      organizationId: row.organization_id,
      action: "AUTH_ORGANIZATION_SELECTED",
      resourceType: "OrganizationMembership",
      resourceId: row.membership_id,
      requestId,
    });
    return row;
  });
  const access = await createAccessToken(
    secret,
    { userId: session.userId, sessionId: session.sessionId, selectedMembershipId: selected.membership_id },
    selected.expires_at,
  );
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    selectedOrganizationId: selected.organization_id,
  };
}
