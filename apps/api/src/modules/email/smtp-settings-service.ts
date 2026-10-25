import type { Pool, PoolClient, QueryResultRow } from "pg";
import { resolveAccessContext } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthSettings, type AuthenticatedSession } from "../auth/auth-service.ts";
import { decryptSmtpPassword, encryptSmtpPassword, type EncryptedSmtpPassword } from "./smtp-settings-crypto.ts";
import { createSmtpEmailSender, readEnvironmentSmtpConfiguration, validateSmtpConfiguration } from "./smtp-transport.ts";
import type { SmtpConfiguration } from "./smtp-transport.ts";

interface SmtpSettingsRow extends QueryResultRow {
  host: string;
  port: number;
  secure: boolean;
  require_tls: boolean;
  from_address: string;
  username: string | null;
  password_envelope: unknown;
  updated_at: Date;
}

export interface SmtpSettingsInput {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  fromAddress: string;
  username: string | null;
  password?: string;
  clearPassword?: boolean;
}

export interface DeliveryPageInput {
  limit: number;
  offset: number;
  outcome?: "SENT" | "FAILED";
  templateCode?: string;
  from?: Date;
  to?: Date;
}

function requireDatabase(database: Pool | undefined): Pool {
  if (!database) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return database;
}

function requirePlatformAdmin(session: AuthenticatedSession): void {
  if (session.platformRole !== "PLATFORM_ADMIN") throw new AuthServiceError(403, "FORBIDDEN", "Esta función está reservada para administración de plataforma.");
}

function requireOrganization(session: AuthenticatedSession): string {
  if (!session.organizationId || !session.selectedMembershipId) throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa para continuar.");
  return session.organizationId;
}

async function requireOrganizationNotificationsRead(database: Pool, session: AuthenticatedSession) {
  const organizationId = requireOrganization(session);
  const context = await resolveAccessContext(database, session.userId, organizationId);
  if (!context?.grants.some((grant) => grant.permissionCode === "notifications.read" && grant.scopeType === "ORGANIZATION" && grant.organizationId === organizationId)) {
    throw new AuthServiceError(403, "FORBIDDEN", "El historial de correo requiere permiso de lectura a nivel de organización.");
  }
  return organizationId;
}

export async function getNotificationAccess(databaseInput: Pool | undefined, session: AuthenticatedSession): Promise<{ canReadHistory: boolean }> {
  const database = requireDatabase(databaseInput);
  if (!session.organizationId || !session.selectedMembershipId) return { canReadHistory: false };
  const context = await resolveAccessContext(database, session.userId, session.organizationId);
  return { canReadHistory: Boolean(context?.grants.some((grant) => grant.permissionCode === "notifications.read" && grant.scopeType === "ORGANIZATION" && grant.organizationId === session.organizationId)) };
}

function readKey(settings: AuthSettings): string {
  const key = settings.smtpSettingsEncryptionKey?.trim();
  const parsed = key ? Buffer.from(key, "base64") : Buffer.alloc(0);
  if (!key || parsed.length !== 32 || parsed.toString("base64") !== key) throw new AuthServiceError(503, "SMTP_SECRET_KEY_UNAVAILABLE", "La configuración segura de correo no está disponible.");
  return key;
}

function validateSettingsInput(configuration: SmtpConfiguration): SmtpConfiguration {
  try {
    return validateSmtpConfiguration(configuration);
  } catch {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La configuración SMTP no es válida.");
  }
}

function settingsResponse(configuration: SmtpConfiguration | null, source: "DATABASE" | "ENVIRONMENT" | "UNCONFIGURED", updatedAt: Date | null) {
  return {
    source,
    configured: configuration !== null,
    host: configuration?.host ?? "",
    port: configuration?.port ?? 587,
    secure: configuration?.secure ?? false,
    requireTls: configuration?.requireTls ?? false,
    fromAddress: configuration?.from ?? "",
    username: configuration?.user ?? "",
    passwordConfigured: Boolean(configuration?.password),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}
async function loadDatabaseSettings(database: Pick<Pool, "query">): Promise<SmtpSettingsRow | null> {
  const result = await database.query<SmtpSettingsRow>(
    `SELECT host, port, secure, require_tls, from_address, username, password_envelope, updated_at
     FROM installation_smtp_settings WHERE id = 1`,
  );
  return result.rows[0] ?? null;
}

function rowToConfiguration(row: SmtpSettingsRow, settings: AuthSettings): SmtpConfiguration {
  const user = row.username ?? undefined;
  let password: string | undefined;
  if (row.password_envelope !== null) password = decryptSmtpPassword(row.password_envelope, readKey(settings));
  return validateSmtpConfiguration({
    host: row.host, port: row.port, secure: row.secure, requireTls: row.require_tls,
    from: row.from_address, ...(user ? { user, password } : {}),
  });
}

export async function getInstallationSmtpSettings(databaseInput: Pool | undefined, session: AuthenticatedSession) {
  requirePlatformAdmin(session);
  const database = requireDatabase(databaseInput);
  const row = await loadDatabaseSettings(database);
  if (row) {
    return settingsResponse({
      host: row.host, port: row.port, secure: row.secure, requireTls: row.require_tls,
      from: row.from_address, ...(row.username ? { user: row.username } : {}),
      ...(row.password_envelope ? { password: "configured" } : {}),
    }, "DATABASE", row.updated_at);
  }
  const environment = readEnvironmentSmtpConfiguration();
  return settingsResponse(environment, environment ? "ENVIRONMENT" : "UNCONFIGURED", null);
}

export async function loadRuntimeSmtpConfiguration(database: Pick<Pool, "query">, settings: AuthSettings): Promise<SmtpConfiguration | null> {
  const row = await loadDatabaseSettings(database);
  return row ? rowToConfiguration(row, settings) : readEnvironmentSmtpConfiguration();
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

export async function saveInstallationSmtpSettings(
  databaseInput: Pool | undefined,
  session: AuthenticatedSession,
  settings: AuthSettings,
  input: SmtpSettingsInput,
  requestId: string,
) {
  const database = requireDatabase(databaseInput);
  requirePlatformAdmin(session);
  const username = input.username?.trim() || undefined;
  const password = input.password || undefined;
  if (input.clearPassword && username) throw new AuthServiceError(400, "INVALID_REQUEST", "Quita el usuario SMTP para borrar sus credenciales.");
  if (password && !username) throw new AuthServiceError(400, "INVALID_REQUEST", "La contraseña SMTP requiere un usuario.");
  const configuration = validateSettingsInput({
    host: input.host, port: input.port, secure: input.secure, requireTls: input.requireTls,
    from: input.fromAddress, ...(username ? { user: username, password: password ?? "placeholder" } : {}),
  });

  return transaction(database, async (client) => {
    const existingResult = await client.query<SmtpSettingsRow>(
      `SELECT host, port, secure, require_tls, from_address, username, password_envelope, updated_at
       FROM installation_smtp_settings WHERE id = 1 FOR UPDATE`,
    );
    const existing = existingResult.rows[0];
    let secret: string | undefined;
    if (username) {
      if (password) secret = password;
      else if (existing?.username === username && existing.password_envelope) secret = decryptSmtpPassword(existing.password_envelope, readKey(settings));
      else {
        const environment = readEnvironmentSmtpConfiguration();
        if (environment?.user === username && environment.password) secret = environment.password;
      }
      if (!secret) throw new AuthServiceError(400, "SMTP_PASSWORD_REQUIRED", "Ingresa la contraseña SMTP para este usuario.");
    } else if (!input.clearPassword && existing?.username) {
      throw new AuthServiceError(400, "SMTP_PASSWORD_CLEAR_REQUIRED", "Confirma que quieres quitar las credenciales SMTP.");
    }

    const envelope: EncryptedSmtpPassword | null = secret ? encryptSmtpPassword(secret, readKey(settings)) : null;
    const saved = await client.query<SmtpSettingsRow>(
      `INSERT INTO installation_smtp_settings (
         id, host, port, secure, require_tls, from_address, username, password_envelope, updated_by, created_at, updated_at
       ) VALUES (1, $1, $2, $3, $4, $5, $6, $7::jsonb, $8::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port, secure = EXCLUDED.secure,
         require_tls = EXCLUDED.require_tls, from_address = EXCLUDED.from_address, username = EXCLUDED.username,
         password_envelope = EXCLUDED.password_envelope, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
       RETURNING host, port, secure, require_tls, from_address, username, password_envelope, updated_at`,
      [configuration.host, configuration.port, configuration.secure, configuration.requireTls, configuration.from, username ?? null, envelope ? JSON.stringify(envelope) : null, session.userId],
    );
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId }, action: "SMTP_CONFIGURATION_UPDATED",
      resourceType: "InstallationSmtpSettings", resourceId: "installation", requestId,
    });
    const row = saved.rows[0];
    if (!row) throw new Error("SMTP settings could not be saved.");
    return settingsResponse({
      host: row.host, port: row.port, secure: row.secure, requireTls: row.require_tls,
      from: row.from_address, ...(row.username ? { user: row.username } : {}),
      ...(row.password_envelope ? { password: "configured" } : {}),
    }, "DATABASE", row.updated_at);
  });
}

export async function sendAuthorizedSmtpTest(
  databaseInput: Pool | undefined,
  session: AuthenticatedSession,
  settings: AuthSettings,
  recipient: string,
  requestId: string,
): Promise<{ sent: true }> {
  const database = requireDatabase(databaseInput);
  requirePlatformAdmin(session);
  const configuration = await loadRuntimeSmtpConfiguration(database, settings);
  if (!configuration) throw new AuthServiceError(409, "SMTP_NOT_CONFIGURED", "Configura el servicio de correo antes de enviar una prueba.");
  let failure = false;
  let sender: ReturnType<typeof createSmtpEmailSender> | undefined;
  try {
    sender = createSmtpEmailSender(configuration);
    await sender.send({ to: recipient, subject: "Prueba de correo", text: "El servicio de correo de la instalación está configurado y puede entregar mensajes." });
  } catch {
    failure = true;
  } finally {
    sender?.close();
  }
  await transaction(database, async (client) => {
    await appendAuditEvent(client, {
      actor: { type: "USER", userId: session.userId },
      action: failure ? "SMTP_TEST_FAILED" : "SMTP_TEST_SUCCEEDED",
      resourceType: "InstallationSmtpSettings", resourceId: "installation", requestId,
    });
  });
  if (failure) throw new AuthServiceError(503, "SMTP_TEST_FAILED", "No fue posible entregar el correo de prueba. Revisa la configuración SMTP.");
  return { sent: true };
}

export async function listEmailTemplates(databaseInput: Pool | undefined, session: AuthenticatedSession) {
  const database = requireDatabase(databaseInput);
  await requireOrganizationNotificationsRead(database, session);
  const result = await database.query<{ code: string; subject: string; status: string; updated_at: Date }>(
    `SELECT code, subject, status, updated_at FROM email_templates ORDER BY code`,
  );
  return { items: result.rows.map((row) => ({ code: row.code, subject: row.subject, status: row.status, updatedAt: row.updated_at.toISOString() })) };
}

export async function listEmailDeliveries(databaseInput: Pool | undefined, session: AuthenticatedSession, input: DeliveryPageInput) {
  const database = requireDatabase(databaseInput);
  const organizationId = await requireOrganizationNotificationsRead(database, session);
  const filters = ["outbox.organization_id = $1::uuid", "($2::\"EmailDeliveryOutcome\" IS NULL OR delivery.outcome = $2)", "($3::text IS NULL OR outbox.template_code = $3)", "($4::timestamptz IS NULL OR delivery.created_at >= $4)", "($5::timestamptz IS NULL OR delivery.created_at <= $5)"];
  const values = [organizationId, input.outcome ?? null, input.templateCode ?? null, input.from ?? null, input.to ?? null];
  const where = filters.join(" AND ");
  const [count, rows] = await Promise.all([
    database.query<{ total: string }>(`SELECT count(*)::text AS total FROM email_deliveries AS delivery JOIN email_outbox AS outbox ON outbox.id = delivery.outbox_id WHERE ${where}`, values),
    database.query<{ id: string; template_code: string; attempt: number; outcome: "SENT" | "FAILED"; error_code: string | null; created_at: Date }>(
      `SELECT delivery.id, outbox.template_code, delivery.attempt, delivery.outcome, delivery.error_code, delivery.created_at
       FROM email_deliveries AS delivery JOIN email_outbox AS outbox ON outbox.id = delivery.outbox_id
       WHERE ${where} ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT $6 OFFSET $7`,
      [...values, input.limit, input.offset],
    ),
  ]);
  return {
    items: rows.rows.map((row) => ({ id: row.id, templateCode: row.template_code, attempt: row.attempt, outcome: row.outcome, errorCode: row.error_code, createdAt: row.created_at.toISOString() })),
    total: Number(count.rows[0]?.total ?? "0"), limit: input.limit, offset: input.offset,
  };
}
