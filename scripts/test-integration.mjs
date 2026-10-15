import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectName = `mvp-integration-${process.pid}`;
const composeFile = resolve(repositoryRoot, "compose.integration.yaml");

function getDockerCommand() {
  const configuredCommand = process.env.DOCKER_CLI_PATH?.trim();
  if (configuredCommand) {
    return configuredCommand;
  }

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE;
    const candidates = [
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
      userProfile &&
        join(userProfile, "AppData", "Local", "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
      process.env.ProgramFiles &&
        join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe"),
    ].filter((candidate) => candidate !== undefined);
    const installedCommand = candidates.find((candidate) => existsSync(candidate));
    if (installedCommand) {
      return installedCommand;
    }
  }

  return "docker";
}

const dockerCommand = getDockerCommand();

function getDockerEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  if (process.platform === "win32" && dockerCommand.toLowerCase().endsWith(".exe")) {
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
    environment[pathKey] = [dirname(dockerCommand), environment[pathKey]].filter(Boolean).join(delimiter);
  }
  return environment;
}

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function runDockerCompose(args, hostPorts) {
  const result = spawnSync(
    dockerCommand,
    ["compose", "-f", composeFile, "-p", projectName, ...args],
    {
      cwd: repositoryRoot,
      env: getDockerEnvironment({
        TEST_POSTGRES_HOST_PORT: String(hostPorts.postgres),
        TEST_MAILPIT_SMTP_HOST_PORT: String(hostPorts.mailpitSmtp),
        TEST_MAILPIT_HTTP_HOST_PORT: String(hostPorts.mailpitHttp),
      }),
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new Error(`No se pudo ejecutar Docker Compose: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Docker Compose terminó con código ${result.status ?? "desconocido"}.`);
  }
}

function runNpmScript(args, environmentOverrides) {
  const npmEntryPoint = process.env.npm_execpath;
  const command = npmEntryPoint
    ? process.execPath
    : process.platform === "win32"
      ? "npm.cmd"
      : "npm";
  const commandArgs = npmEntryPoint ? [npmEntryPoint, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environmentOverrides },
    stdio: "inherit",
    windowsHide: true,
    shell: !npmEntryPoint && process.platform === "win32",
  });

  if (result.error) {
    throw new Error(`No se pudo ejecutar npm para preparar la BD de integración: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`La preparación de la BD de integración terminó con código ${result.status ?? "desconocido"}.`);
  }
}

async function expectPostgresCode(action, expectedCode, message) {
  await assert.rejects(action, (error) => {
    assert.ok(error && typeof error === "object" && "code" in error);
    assert.equal(error.code, expectedCode, message);
    return true;
  });
}

async function verifyDataModel(database) {
  const seeded = await database.query(`
    SELECT organization.id AS organization_id, app_user.id AS user_id,
      membership.id AS membership_id, role.id AS role_id,
      company.id AS company_id, branch.id AS branch_id
    FROM organizations AS organization
    JOIN companies AS company ON company.organization_id = organization.id
    JOIN branches AS branch ON branch.company_id = company.id
    JOIN organization_memberships AS membership ON membership.organization_id = organization.id
    JOIN users AS app_user ON app_user.id = membership.user_id
    JOIN role_assignments AS assignment ON assignment.membership_id = membership.id
    JOIN roles AS role ON role.id = assignment.role_id
    WHERE app_user.normalized_email IN ('demo.admin.a@example.test', 'demo.supervisor.b@example.test')
    ORDER BY app_user.normalized_email
  `);
  assert.equal(seeded.rows.length, 2, "El seed debe crear fixtures aislados en dos tenants.");
  const platformPermissions = await database.query(
    "SELECT count(*)::int AS count FROM permissions WHERE code LIKE 'organizations.%'",
  );
  assert.equal(platformPermissions.rows[0].count, 5, "El catálogo debe incluir permisos de plataforma.");
  const tenantPlatformGrants = await database.query(
    "SELECT count(*)::int AS count FROM role_permissions WHERE permission_code LIKE 'organizations.%'",
  );
  assert.equal(tenantPlatformGrants.rows[0].count, 0, "Los roles de tenant no deben recibir permisos de plataforma.");

  const tenantA = seeded.rows[0];
  const tenantB = seeded.rows[1];
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await expectPostgresCode(
    database.query(
      `INSERT INTO branches (id, organization_id, company_id, code, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'CROSS-TENANT', 'Inválida')`,
      ["00000000-0000-4000-8000-000000000071", tenantA.organization_id, tenantB.company_id],
    ),
    "23503",
    "La FK de sucursal debe impedir una empresa de otro tenant.",
  );

  await expectPostgresCode(
    database.query(
      `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION')`,
      ["00000000-0000-4000-8000-000000000072", tenantA.organization_id, tenantA.membership_id, tenantB.role_id],
    ),
    "23503",
    "La FK de asignación debe impedir un rol de otro tenant.",
  );

  await expectPostgresCode(
    database.query(
      `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type, company_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION', $5::uuid)`,
      ["00000000-0000-4000-8000-000000000073", tenantA.organization_id, tenantA.membership_id, tenantA.role_id, tenantA.company_id],
    ),
    "23514",
    "La restricción de scope debe exigir company y branch según el tipo.",
  );

  await expectPostgresCode(
    database.query(
      `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type, company_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'COMPANY', $5::uuid)`,
      ["00000000-0000-4000-8000-000000000076", tenantA.organization_id, tenantA.membership_id, tenantA.role_id, tenantB.company_id],
    ),
    "23503",
    "Una asignación COMPANY no debe aceptar una empresa de otro tenant.",
  );

  await expectPostgresCode(
    database.query(
      `INSERT INTO branches (id, organization_id, company_id, code, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'CENTRAL', 'Duplicada')`,
      ["00000000-0000-4000-8000-000000000077", tenantA.organization_id, tenantA.company_id],
    ),
    "23505",
    "El código de sucursal debe ser único dentro de una empresa.",
  );

  await database.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
    ["00000000-0000-4000-8000-000000000074", tenantA.user_id, expiresAt],
  );
  await expectPostgresCode(
    database.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
      ["00000000-0000-4000-8000-000000000075", tenantA.user_id, expiresAt],
    ),
    "23505",
    "El índice parcial debe impedir dos sesiones no revocadas del mismo usuario.",
  );
  await database.query(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
    ["00000000-0000-4000-8000-000000000074"],
  );
  await database.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
    ["00000000-0000-4000-8000-000000000075", tenantA.user_id, expiresAt],
  );
}

async function waitForMailpit(httpPort) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/api/v1/info`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Mailpit may need a few seconds after Docker reports the container as running.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Mailpit no respondió en el tiempo esperado.");
}

async function verifyAuditAndEmail(database, smtpPort, mailpitHttpPort) {
  const { appendAuditEvent } = await import("../apps/api/dist/modules/audit/audit-service.js");
  const { enqueueEmail } = await import("../apps/api/dist/modules/email/outbox-service.js");
  const { processOutboxBatch } = await import("../apps/api/dist/modules/email/outbox-worker.js");
  const { createSmtpEmailSender } = await import("../apps/api/dist/modules/email/smtp-transport.js");
  const encryptionKey = Buffer.alloc(32, 73).toString("base64");
  const marker = randomUUID();
  const rollbackRequestId = `task003-${marker}-rollback`;
  const recipient = `task003.${marker}@example.test`;
  const deduplicationKey = `task003:${marker}`;
  const activationToken = `integration-secret-${randomUUID()}`;
  const tenant = (
    await database.query(
      `SELECT organization.id AS organization_id, organization.name AS organization_name,
         app_user.id AS user_id
       FROM organizations AS organization
       JOIN organization_memberships AS membership ON membership.organization_id = organization.id
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE app_user.normalized_email = 'demo.admin.a@example.test'`,
    )
  ).rows[0];
  assert.ok(tenant, "Debe existir el usuario local de fixture.");

  const rollbackClient = await database.connect();
  try {
    await rollbackClient.query("BEGIN");
    await rollbackClient.query("UPDATE organizations SET name = $2 WHERE id = $1::uuid", [
      tenant.organization_id,
      `Rollback ${marker}`,
    ]);
    await appendAuditEvent(rollbackClient, {
      organizationId: tenant.organization_id,
      actor: { type: "USER", userId: tenant.user_id },
      action: "task003.rollback_check",
      resourceType: "organization",
      resourceId: tenant.organization_id,
      requestId: rollbackRequestId,
      before: { name: tenant.organization_name },
      after: { name: `Rollback ${marker}` },
    });
    await enqueueEmail(
      rollbackClient,
      {
        organizationId: tenant.organization_id,
        templateCode: "account.activation",
        recipient,
        deduplicationKey,
        payload: { displayName: "Prueba rollback", actionUrl: `https://example.test/?token=${activationToken}` },
      },
      encryptionKey,
    );
    await rollbackClient.query("ROLLBACK");
  } catch (error) {
    await rollbackClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    rollbackClient.release();
  }

  const rolledBackOrganization = await database.query(
    "SELECT name FROM organizations WHERE id = $1::uuid",
    [tenant.organization_id],
  );
  assert.equal(rolledBackOrganization.rows[0].name, tenant.organization_name, "El cambio del recurso debe revertirse.");
  const rolledBackAudit = await database.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE request_id = $1",
    [rollbackRequestId],
  );
  assert.equal(rolledBackAudit.rows[0].count, 0, "La auditoría debe compartir la transacción del recurso.");
  const rolledBackEmail = await database.query(
    "SELECT count(*)::int AS count FROM email_outbox WHERE deduplication_key = $1",
    [deduplicationKey],
  );
  assert.equal(rolledBackEmail.rows[0].count, 0, "El correo debe compartir la transacción del recurso.");

  const auditEventId = await appendAuditEvent(database, {
    organizationId: tenant.organization_id,
    actor: { type: "USER", userId: tenant.user_id },
    action: "task003.sanitization_check",
    resourceType: "user",
    resourceId: tenant.user_id,
    requestId: `task003-${marker}-audit`,
    before: { displayName: "Nombre anterior", password: "audit-password-secret", filePath: "private/document.pdf" },
    after: { displayName: "Nombre nuevo", resetToken: "audit-token-secret", status: "ACTIVE" },
  });
  const auditRow = await database.query("SELECT diff FROM audit_events WHERE id = $1::uuid", [auditEventId]);
  const sanitizedDiff = auditRow.rows[0].diff;
  const serializedDiff = JSON.stringify(sanitizedDiff);
  assert.equal(sanitizedDiff.before.displayName, "Nombre anterior");
  assert.equal(sanitizedDiff.after.displayName, "Nombre nuevo");
  assert.doesNotMatch(serializedDiff, /audit-password-secret|audit-token-secret|private\/document\.pdf/u);
  await expectPostgresCode(
    database.query("UPDATE audit_events SET action = 'tampered' WHERE id = $1::uuid", [auditEventId]),
    "55000",
    "La auditoría debe rechazar modificaciones.",
  );
  await expectPostgresCode(
    database.query("DELETE FROM audit_events WHERE id = $1::uuid", [auditEventId]),
    "55000",
    "La auditoría debe rechazar borrados.",
  );
  await expectPostgresCode(
    database.query("TRUNCATE audit_events"),
    "55000",
    "La auditoría debe rechazar truncados.",
  );

  const emailClient = await database.connect();
  let queuedEmail;
  try {
    await emailClient.query("BEGIN");
    queuedEmail = await enqueueEmail(
      emailClient,
      {
        organizationId: tenant.organization_id,
        templateCode: "account.activation",
        recipient,
        deduplicationKey,
        payload: {
          displayName: "Prueba local",
          actionUrl: `https://example.test/activate?token=${activationToken}`,
        },
      },
      encryptionKey,
    );
    const duplicateEmail = await enqueueEmail(
      emailClient,
      {
        organizationId: tenant.organization_id,
        templateCode: "account.activation",
        recipient,
        deduplicationKey,
        payload: { displayName: "Duplicado", actionUrl: "https://example.test/duplicate" },
      },
      encryptionKey,
    );
    assert.equal(queuedEmail.inserted, true);
    assert.equal(duplicateEmail.inserted, false, "La misma clave de evento no debe crear otro outbox.");
    assert.equal(duplicateEmail.id, queuedEmail.id);
    await emailClient.query("COMMIT");
  } catch (error) {
    await emailClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    emailClient.release();
  }

  const persistedPayload = await database.query(
    "SELECT payload::text AS payload FROM email_outbox WHERE id = $1::uuid",
    [queuedEmail.id],
  );
  assert.doesNotMatch(persistedPayload.rows[0].payload, new RegExp(activationToken, "u"), "El payload privado debe cifrarse en la BD.");

  const failureSender = {
    async send() {
      throw Object.assign(new Error(`SMTP failure contains ${activationToken}`), { code: "ECONNECTION" });
    },
    close() {},
  };
  const retryOptions = { encryptionKey, maxAttempts: 3, leaseMs: 1_000, retryBaseMs: 1_000, random: () => 0 };
  const failedAttempt = await processOutboxBatch(database, failureSender, retryOptions);
  assert.deepEqual(failedAttempt, { claimed: 1, sent: 0, failed: 1 });
  await database.query("UPDATE email_outbox SET next_attempt_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", [queuedEmail.id]);
  const beforeDelivery = await database.query(
    "SELECT last_error_code, status, attempts FROM email_outbox WHERE id = $1::uuid",
    [queuedEmail.id],
  );
  assert.equal(beforeDelivery.rows[0].last_error_code, "ECONNECTION");
  assert.equal(beforeDelivery.rows[0].status, "FAILED");
  assert.equal(beforeDelivery.rows[0].attempts, 1);

  const smtpSender = createSmtpEmailSender({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    SMTP_FROM: "MVP Transporte <no-reply@example.test>",
  });
  try {
    const delivered = await processOutboxBatch(database, smtpSender, retryOptions);
    assert.deepEqual(delivered, { claimed: 1, sent: 1, failed: 0 });
  } finally {
    smtpSender.close();
  }

  const completedEmail = await database.query(
    "SELECT status, attempts, last_error_code FROM email_outbox WHERE id = $1::uuid",
    [queuedEmail.id],
  );
  assert.deepEqual(completedEmail.rows[0], { status: "SENT", attempts: 2, last_error_code: null });
  const deliveries = await database.query(
    "SELECT attempt, outcome, error_code FROM email_deliveries WHERE outbox_id = $1::uuid ORDER BY attempt",
    [queuedEmail.id],
  );
  assert.deepEqual(deliveries.rows, [
    { attempt: 1, outcome: "FAILED", error_code: "ECONNECTION" },
    { attempt: 2, outcome: "SENT", error_code: null },
  ]);
  assert.doesNotMatch(JSON.stringify(deliveries.rows), new RegExp(activationToken, "u"));

  const messageListResponse = await fetch(
    `http://127.0.0.1:${mailpitHttpPort}/api/v1/messages?start=0&limit=50`,
  );
  assert.equal(messageListResponse.status, 200, "Mailpit debe listar el mensaje entregado.");
  const messageList = await messageListResponse.json();
  assert.ok(Array.isArray(messageList.messages), "Mailpit debe devolver la lista de mensajes.");
  const deliveredMessage = messageList.messages.find(
    (message) => message.Subject === "Activa tu cuenta" && JSON.stringify(message.To).includes(recipient),
  );
  assert.ok(deliveredMessage, "El buzón local debe recibir el correo de activación.");
  const messageTextResponse = await fetch(
    `http://127.0.0.1:${mailpitHttpPort}/view/${encodeURIComponent(deliveredMessage.ID)}.txt`,
  );
  assert.equal(messageTextResponse.status, 200, "Mailpit debe permitir leer el cuerpo de texto.");
  const messageText = await messageTextResponse.text();
  assert.ok(messageText.includes(activationToken), "El enlace de activación debe llegar al buzón local.");
  assert.ok(messageText.includes("Prueba local"));

  const exhaustedRecipient = `task003.expired.${marker}@example.test`;
  const exhaustedKey = `task003-expired:${marker}`;
  const expiredEmail = await enqueueEmail(
    database,
    {
      organizationId: tenant.organization_id,
      templateCode: "account.activation",
      recipient: exhaustedRecipient,
      deduplicationKey: exhaustedKey,
      payload: { displayName: "Lease agotado", actionUrl: "https://example.test/expired" },
    },
    encryptionKey,
  );
  await database.query(
    `UPDATE email_outbox
     SET status = 'PROCESSING', attempts = 2, locked_at = CURRENT_TIMESTAMP - INTERVAL '2 seconds',
         lock_token = gen_random_uuid()
     WHERE id = $1::uuid`,
    [expiredEmail.id],
  );
  let shouldNotSend = 0;
  const expiredLease = await processOutboxBatch(
    database,
    { async send() { shouldNotSend += 1; }, close() {} },
    { encryptionKey, maxAttempts: 2, leaseMs: 1_000 },
  );
  assert.deepEqual(expiredLease, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(shouldNotSend, 0, "Un lease expirado y agotado no debe volver a enviarse.");
  const exhaustedState = await database.query(
    "SELECT status, attempts, last_error_code FROM email_outbox WHERE id = $1::uuid",
    [expiredEmail.id],
  );
  assert.deepEqual(exhaustedState.rows[0], {
    status: "FAILED",
    attempts: 2,
    last_error_code: "DELIVERY_OUTCOME_UNKNOWN",
  });
  const noFurtherRetry = await processOutboxBatch(
    database,
    { async send() { shouldNotSend += 1; }, close() {} },
    { encryptionKey, maxAttempts: 2, leaseMs: 1_000 },
  );
  assert.deepEqual(noFurtherRetry, { claimed: 0, sent: 0, failed: 0 });
  assert.equal(shouldNotSend, 0, "Un correo agotado no debe reintentarse una vez más.");
}

function cookieValue(response, name) {
  const lines = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*mvp_)/u);
  const cookie = lines.find((line) => line.trimStart().startsWith(`${name}=`));
  assert.ok(cookie, `La respuesta debe emitir la cookie ${name}.`);
  return cookie.trim().split(";", 1)[0].slice(name.length + 1);
}

function authCookies(refreshToken, csrfToken) {
  return `mvp_refresh=${refreshToken}; mvp_csrf=${csrfToken}`;
}

async function apiRequest(baseUrl, path, options = {}) {
  const headers = { Origin: "http://127.0.0.1:5173", connection: "close" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.cookies) {
    headers.Cookie = options.cookies;
  }
  if (options.csrfToken) {
    headers["X-CSRF-Token"] = options.csrfToken;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

async function getMailpitText(httpPort, recipient, subjectPart) {
  const response = await fetch(`http://127.0.0.1:${httpPort}/api/v1/messages?start=0&limit=200`);
  assert.equal(response.status, 200, "Mailpit debe listar los mensajes de TASK-004.");
  const result = await response.json();
  const message = result.messages.find((candidate) =>
    candidate.Subject.includes(subjectPart) && JSON.stringify(candidate.To).toLowerCase().includes(recipient.toLowerCase()),
  );
  assert.ok(message, `Mailpit debe contener '${subjectPart}' para ${recipient}.`);
  const textResponse = await fetch(`http://127.0.0.1:${httpPort}/view/${encodeURIComponent(message.ID)}.txt`);
  assert.equal(textResponse.status, 200, "Mailpit debe devolver el mensaje como texto.");
  return textResponse.text();
}

function tokenFromEmail(messageText) {
  const match = messageText.match(/[?&]token=([A-Za-z0-9_-]{40,})/u);
  assert.ok(match, "El correo debe contener un token de un solo uso.");
  return match[1];
}

async function deliverQueuedAuthMessages(database, smtpPort, encryptionKey) {
  const pending = await database.query("SELECT count(*)::int AS total FROM email_outbox WHERE status = 'PENDING'");
  const expected = pending.rows[0].total;
  if (expected === 0) {
    return;
  }
  const { processOutboxBatch } = await import("../apps/api/dist/modules/email/outbox-worker.js");
  const { createSmtpEmailSender } = await import("../apps/api/dist/modules/email/smtp-transport.js");
  const sender = createSmtpEmailSender({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    SMTP_FROM: "MVP Transporte <no-reply@example.test>",
  });
  try {
    const result = await processOutboxBatch(database, sender, { encryptionKey, batchSize: 25, maxAttempts: 5, leaseMs: 1_000 });
    assert.equal(result.claimed, expected, "El worker debe reclamar los mensajes de autenticación en cola.");
    assert.equal(result.sent, expected, "Mailpit debe aceptar los mensajes de autenticación.");
    assert.equal(result.failed, 0);
  } finally {
    sender.close();
  }
}

async function verifyAuthentication(database, smtpPort, mailpitHttpPort, createApp) {
  const marker = randomUUID();
  const multiEmail = `task004.multi.${marker}@example.test`;
  const existingInviteEmail = `task004.existing.${marker}@example.test`;
  const newInviteEmail = `task004.new.${marker}@example.test`;
  const platformEmail = `task004.platform.${marker}@example.test`;
  const oldPassword = "Old Multi Tenant Password 2026!";
  const newPassword = "New Multi Tenant Password 2026!";
  const existingPassword = "Existing User Password 2026!";
  const encryptionKey = Buffer.alloc(32, 73).toString("base64");
  const accessTokenSecret = Buffer.alloc(32, 91).toString("base64");
  const settings = {
    accessTokenSecret,
    emailPayloadEncryptionKey: encryptionKey,
    publicWebUrl: "http://127.0.0.1:5173",
    secureCookies: false,
  };
  const organizations = await database.query(
    "SELECT id, name FROM organizations WHERE name IN ('Tenant de desarrollo A', 'Tenant de desarrollo B') ORDER BY name",
  );
  assert.equal(organizations.rows.length, 2);
  const tenantA = organizations.rows.find((item) => item.name === "Tenant de desarrollo A");
  const tenantB = organizations.rows.find((item) => item.name === "Tenant de desarrollo B");
  assert.ok(tenantA && tenantB);

  const { hashPassword } = await import("../apps/api/dist/modules/auth/auth-crypto.js");
  const multiHash = await hashPassword(oldPassword);
  const existingHash = await hashPassword(existingPassword);
  const supervisorHash = await hashPassword("Supervisor Password 2026!");
  const multiUserId = randomUUID();
  const existingUserId = randomUUID();
  await database.query(
    `INSERT INTO users (id, normalized_email, display_name, password_hash, status, updated_at)
     VALUES ($1::uuid, $2, 'Administradora de prueba', $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [multiUserId, multiEmail, multiHash],
  );
  await database.query(
    `INSERT INTO users (id, normalized_email, display_name, password_hash, status, updated_at)
     VALUES ($1::uuid, $2, 'Perfil existente sin cambios', $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [existingUserId, existingInviteEmail, existingHash],
  );
  async function addMembership(userId, organizationId, admin) {
    const membershipId = randomUUID();
    await database.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVE', CURRENT_TIMESTAMP)`,
      [membershipId, organizationId, userId],
    );
    if (admin) {
      const role = await database.query(
        "SELECT id FROM roles WHERE organization_id = $1::uuid AND code = 'admin'",
        [organizationId],
      );
      assert.ok(role.rows[0]);
      await database.query(
        `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION')`,
        [randomUUID(), organizationId, membershipId, role.rows[0].id],
      );
    }
    return membershipId;
  }
  await addMembership(multiUserId, tenantA.id, true);
  await addMembership(multiUserId, tenantB.id, true);
  await addMembership(existingUserId, tenantA.id, false);

  const supervisor = await database.query(
    `UPDATE users SET password_hash = $1, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
     WHERE normalized_email = 'demo.supervisor.b@example.test' RETURNING id`,
    [supervisorHash],
  );
  assert.ok(supervisor.rows[0]);
  const { bootstrapPlatformAdmin } = await import("../apps/api/dist/modules/organizations/platform-service.js");
  await bootstrapPlatformAdmin(database, settings, {
    email: platformEmail,
    displayName: "Administradora de plataforma de prueba",
    requestId: `task004-${marker}-bootstrap`,
  });

  const app = createApp({
    database,
    allowedOrigins: ["http://127.0.0.1:5173"],
    authSettings: settings,
    checkDatabase: async () => { await database.query("SELECT 1"); },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.once("listening", resolveListen);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rejectedOrigin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      origin: "https://untrusted.example",
      body: { email: multiEmail, password: oldPassword },
    });
    assert.equal(rejectedOrigin.response.status, 403, "El login debe rechazar orígenes que no están en la allowlist.");

    const concurrentLogins = await Promise.all([1, 2].map(() => apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: multiEmail, password: oldPassword },
    })));
    for (const outcome of concurrentLogins) {
      assert.equal(outcome.response.status, 200, "Las credenciales válidas deben iniciar sesión.");
      assert.equal(outcome.body.user.email, multiEmail);
      assert.ok(!Object.hasOwn(outcome.body, "refreshToken"), "El refresh token no debe estar en JSON.");
      assert.equal(outcome.response.headers.get("cache-control"), "no-store");
    }
    const activeSessionCount = await database.query(
      "SELECT count(*)::int AS total FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    assert.equal(activeSessionCount.rows[0].total, 1, "Dos logins concurrentes deben dejar una sesión activa.");

    const authenticatedOutcomes = [];
    for (const outcome of concurrentLogins) {
      const me = await apiRequest(baseUrl, "/auth/me", { accessToken: outcome.body.accessToken });
      authenticatedOutcomes.push({ outcome, me });
    }
    const currentLogin = authenticatedOutcomes.find((item) => item.me.response.status === 200);
    const replacedLogin = authenticatedOutcomes.find((item) => item.me.response.status === 401);
    assert.ok(currentLogin && replacedLogin, "Solo el último login concurrente debe conservar acceso.");
    const originalRefresh = cookieValue(currentLogin.outcome.response, "mvp_refresh");
    const originalCsrf = currentLogin.outcome.body.csrfToken;
    const wrongCsrf = await apiRequest(baseUrl, "/auth/refresh", {
      method: "POST",
      cookies: authCookies(originalRefresh, originalCsrf),
      csrfToken: "0".repeat(64),
    });
    assert.equal(wrongCsrf.response.status, 403, "Refresh exige cookie CSRF y header coincidentes.");
    const rotation = await apiRequest(baseUrl, "/auth/refresh", {
      method: "POST",
      cookies: authCookies(originalRefresh, originalCsrf),
      csrfToken: originalCsrf,
    });
    assert.equal(rotation.response.status, 200, "El refresh válido debe rotar el token.");
    const rotatedRefresh = cookieValue(rotation.response, "mvp_refresh");
    assert.notEqual(rotatedRefresh, originalRefresh);
    const replay = await apiRequest(baseUrl, "/auth/refresh", {
      method: "POST",
      cookies: authCookies(originalRefresh, rotation.body.csrfToken),
      csrfToken: rotation.body.csrfToken,
    });
    assert.equal(replay.response.status, 401, "Reutilizar un refresh consumido debe fallar.");
    const revokedAfterReplay = await database.query(
      "SELECT revoked_at FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    assert.equal(revokedAfterReplay.rows.length, 0, "El replay debe revocar la sesión y su familia.");
    const tokenHashes = await database.query(
      "SELECT token_hash FROM refresh_tokens WHERE session_id = (SELECT id FROM sessions WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 1)",
      [multiUserId],
    );
    assert.ok(tokenHashes.rows.every((row) => row.token_hash !== originalRefresh && row.token_hash !== rotatedRefresh));

    const adminLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: multiEmail, password: oldPassword },
    });
    assert.equal(adminLogin.response.status, 200);
    let adminToken = adminLogin.body.accessToken;
    let adminMe = await apiRequest(baseUrl, "/auth/me", { accessToken: adminToken });
    assert.equal(adminMe.response.status, 200);
    assert.equal(adminMe.body.organizations.length, 2, "El usuario global debe tener acceso a dos tenants.");
    assert.ok(adminMe.body.permissions.includes("users.read"));
    const originalSelectedOrganization = adminMe.body.selectedOrganizationId;
    const nextOrganization = adminMe.body.organizations.find((item) => item.id !== originalSelectedOrganization);
    assert.ok(nextOrganization);
    const sessionBeforeSwitch = await database.query(
      "SELECT id FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    const selected = await apiRequest(baseUrl, "/auth/select-organization", {
      method: "POST",
      accessToken: adminToken,
      body: { organizationId: nextOrganization.id },
    });
    assert.equal(selected.response.status, 200, "La cuenta debe poder cambiar el tenant seleccionado.");
    assert.equal(selected.body.selectedOrganizationId, nextOrganization.id);
    adminToken = selected.body.accessToken;
    adminMe = await apiRequest(baseUrl, "/auth/me", { accessToken: adminToken });
    assert.equal(adminMe.body.selectedOrganizationId, nextOrganization.id);
    const sessionAfterSwitch = await database.query(
      "SELECT id, selected_membership_id FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    assert.equal(sessionAfterSwitch.rows[0].id, sessionBeforeSwitch.rows[0].id, "Cambiar tenant debe conservar la sesión.");
    const usersPage = await apiRequest(baseUrl, "/organizations/users?limit=1&offset=0", { accessToken: adminToken });
    assert.equal(usersPage.response.status, 200, "El administrador de tenant debe leer usuarios dentro del tenant.");
    assert.equal(usersPage.body.limit, 1);

    const forbiddenInvite = await apiRequest(baseUrl, "/organizations/users/invitations", {
      method: "POST",
      accessToken: adminToken,
      body: { email: "new.user@example.test", displayName: "Usuario" },
    });
    assert.equal(forbiddenInvite.response.status, 202, "El administrador puede invitar usuarios.");

    const supervisorLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: "demo.supervisor.b@example.test", password: "Supervisor Password 2026!" },
    });
    assert.equal(supervisorLogin.response.status, 200);
    const supervisorUsers = await apiRequest(baseUrl, "/organizations/users", { accessToken: supervisorLogin.body.accessToken });
    assert.equal(supervisorUsers.response.status, 403, "Un supervisor no debe leer usuarios sin permiso.");
    const supervisorInvite = await apiRequest(baseUrl, "/organizations/users/invitations", {
      method: "POST",
      accessToken: supervisorLogin.body.accessToken,
      body: { email: newInviteEmail, displayName: "No autorizado" },
    });
    assert.equal(supervisorInvite.response.status, 403, "Un supervisor no debe invitar sin permiso.");

    const existingInvite = await apiRequest(baseUrl, "/organizations/users/invitations", {
      method: "POST",
      accessToken: adminToken,
      body: { email: existingInviteEmail, displayName: "Intento de cambiar nombre" },
    });
    assert.equal(existingInvite.response.status, 202);
    const newInvite = await apiRequest(baseUrl, "/organizations/users/invitations", {
      method: "POST",
      accessToken: adminToken,
      body: { email: newInviteEmail, displayName: "Nueva persona" },
    });
    assert.equal(newInvite.response.status, existingInvite.response.status);
    assert.deepEqual(newInvite.body, existingInvite.body, "Invitaciones existentes y nuevas deben responder igual.");
    const existingAfterInvite = await database.query(
      "SELECT display_name, password_hash FROM users WHERE id = $1::uuid",
      [existingUserId],
    );
    assert.equal(existingAfterInvite.rows[0].display_name, "Perfil existente sin cambios");
    assert.equal(existingAfterInvite.rows[0].password_hash, existingHash, "La invitación no debe cambiar la contraseña global.");

    const { processOutboxBatch } = await import("../apps/api/dist/modules/email/outbox-worker.js");
    const { createSmtpEmailSender } = await import("../apps/api/dist/modules/email/smtp-transport.js");
    const sender = createSmtpEmailSender({
      SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false", SMTP_FROM: "MVP Transporte <no-reply@example.test>",
    });
    try {
      const sent = await processOutboxBatch(database, sender, { encryptionKey, batchSize: 25, maxAttempts: 5, leaseMs: 1_000 });
      assert.equal(sent.failed, 0);
      assert.ok(sent.sent >= 3, "Bootstrap e invitaciones deben enviarse a Mailpit.");
    } finally {
      sender.close();
    }

    const bootstrapText = await getMailpitText(mailpitHttpPort, platformEmail, "Activa tu cuenta");
    const bootstrapToken = tokenFromEmail(bootstrapText);
    const bootstrapInspect = await apiRequest(baseUrl, "/auth/activation/inspect", { method: "POST", body: { token: bootstrapToken } });
    assert.equal(bootstrapInspect.response.status, 200);
    assert.equal(bootstrapInspect.body.purpose, "PLATFORM_ACTIVATION");
    assert.equal(bootstrapInspect.body.requiresPassword, true);
    const bootstrapComplete = await apiRequest(baseUrl, "/auth/activation/complete", {
      method: "POST", body: { token: bootstrapToken, password: "Platform Administrator Password 2026!" },
    });
    assert.equal(bootstrapComplete.response.status, 200);
    const tokenPersisted = await database.query("SELECT token_hash FROM account_tokens WHERE user_id = (SELECT id FROM users WHERE normalized_email = $1)", [platformEmail]);
    assert.ok(tokenPersisted.rows.every((row) => row.token_hash !== bootstrapToken), "Los tokens de activación deben persistirse solo como hash.");
    const repeatedBootstrap = await apiRequest(baseUrl, "/auth/activation/complete", {
      method: "POST", body: { token: bootstrapToken, password: "Platform Administrator Password 2026!" },
    });
    assert.equal(repeatedBootstrap.response.status, 400, "Un enlace de activación solo puede usarse una vez.");

    const platformLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: platformEmail, password: "Platform Administrator Password 2026!" },
    });
    assert.equal(platformLogin.response.status, 200);
    const createdOrganization = await apiRequest(baseUrl, "/platform/organizations", {
      method: "POST",
      accessToken: platformLogin.body.accessToken,
      body: {
        organizationName: `Tenant de TASK-004 ${marker}`,
        adminEmail: existingInviteEmail,
        adminDisplayName: "Este nombre no debe sobrescribir el perfil",
      },
    });
    assert.equal(createdOrganization.response.status, 201, "Un administrador de plataforma debe crear tenant y administrador.");
    const tenantAdmin = await database.query(
      `SELECT membership.id AS membership_id, role.id AS role_id
       FROM organization_memberships AS membership
       JOIN role_assignments AS assignment ON assignment.membership_id = membership.id
       JOIN roles AS role ON role.id = assignment.role_id
       WHERE membership.organization_id = $1::uuid AND membership.user_id = $2::uuid AND role.code = 'admin'`,
      [createdOrganization.body.id, existingUserId],
    );
    assert.ok(tenantAdmin.rows[0], "El tenant nuevo debe asignar el rol inicial de administrador.");
    const organizationPermissionLeak = await database.query(
      `SELECT count(*)::int AS total FROM role_permissions
       WHERE role_id = $1::uuid AND permission_code LIKE 'organizations.%'`,
      [tenantAdmin.rows[0].role_id],
    );
    assert.equal(organizationPermissionLeak.rows[0].total, 0, "El admin de tenant no debe recibir permisos de plataforma.");

    await deliverQueuedAuthMessages(database, smtpPort, encryptionKey);
    const platformInvitationText = await getMailpitText(mailpitHttpPort, existingInviteEmail, createdOrganization.body.name);
    const platformInvitationToken = tokenFromEmail(platformInvitationText);
    const existingInviteText = await getMailpitText(mailpitHttpPort, existingInviteEmail, tenantB.name);
    const existingInviteToken = tokenFromEmail(existingInviteText);
    const newInviteText = await getMailpitText(mailpitHttpPort, newInviteEmail, tenantB.name);
    const newInviteToken = tokenFromEmail(newInviteText);

    const existingInspect = await apiRequest(baseUrl, "/auth/activation/inspect", { method: "POST", body: { token: existingInviteToken } });
    assert.equal(existingInspect.response.status, 200);
    assert.equal(existingInspect.body.purpose, "MEMBERSHIP_INVITATION");
    assert.equal(existingInspect.body.requiresPassword, false, "Una identidad activa acepta la membresía sin restablecer su contraseña.");
    const existingActivation = await apiRequest(baseUrl, "/auth/activation/complete", { method: "POST", body: { token: existingInviteToken } });
    assert.equal(existingActivation.response.status, 200);
    const existingAfterAccept = await database.query(
      `SELECT app_user.display_name, app_user.password_hash, membership.status
       FROM users AS app_user
       JOIN organization_memberships AS membership ON membership.user_id = app_user.id
       WHERE app_user.id = $1::uuid AND membership.organization_id = $2::uuid`,
      [existingUserId, tenantB.id],
    );
    assert.equal(existingAfterAccept.rows[0].display_name, "Perfil existente sin cambios");
    assert.equal(existingAfterAccept.rows[0].password_hash, existingHash);
    assert.equal(existingAfterAccept.rows[0].status, "ACTIVE");

    const newInspect = await apiRequest(baseUrl, "/auth/activation/inspect", { method: "POST", body: { token: newInviteToken } });
    assert.equal(newInspect.response.status, 200);
    assert.equal(newInspect.body.requiresPassword, true, "Una cuenta nueva debe definir su contraseña.");
    const newActivation = await apiRequest(baseUrl, "/auth/activation/complete", {
      method: "POST", body: { token: newInviteToken, password: "New Invited User Password 2026!" },
    });
    assert.equal(newActivation.response.status, 200);
    const platformInviteInspect = await apiRequest(baseUrl, "/auth/activation/inspect", { method: "POST", body: { token: platformInvitationToken } });
    assert.equal(platformInviteInspect.response.status, 200);
    assert.equal(platformInviteInspect.body.requiresPassword, false);
    const platformInviteAccept = await apiRequest(baseUrl, "/auth/activation/complete", { method: "POST", body: { token: platformInvitationToken } });
    assert.equal(platformInviteAccept.response.status, 200);
    const existingLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: existingInviteEmail, password: existingPassword } });
    assert.equal(existingLogin.response.status, 200, "La aceptación no debe cambiar la contraseña global existente.");
    const existingMe = await apiRequest(baseUrl, "/auth/me", { accessToken: existingLogin.body.accessToken });
    assert.equal(existingMe.body.organizations.length, 3, "La misma identidad debe conservar sus varios tenants.");
    const newUserLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: newInviteEmail, password: "New Invited User Password 2026!" } });
    assert.equal(newUserLogin.response.status, 200, "La persona invitada debe poder iniciar sesión tras activar.");

    const knownRecovery = await apiRequest(baseUrl, "/auth/recovery", { method: "POST", body: { email: multiEmail } });
    const unknownRecovery = await apiRequest(baseUrl, "/auth/recovery", { method: "POST", body: { email: `missing.${marker}@example.test` } });
    assert.equal(knownRecovery.response.status, 202);
    assert.equal(unknownRecovery.response.status, 202);
    assert.deepEqual(knownRecovery.body, unknownRecovery.body, "Recuperación no debe revelar la existencia del correo.");
    await deliverQueuedAuthMessages(database, smtpPort, encryptionKey);
    const recoveryText = await getMailpitText(mailpitHttpPort, multiEmail, "Recupera tu contraseña");
    const recoveryToken = tokenFromEmail(recoveryText);
    const recoveryComplete = await apiRequest(baseUrl, "/auth/recovery/complete", {
      method: "POST", body: { token: recoveryToken, password: newPassword },
    });
    assert.equal(recoveryComplete.response.status, 204);
    const activeAfterRecovery = await database.query(
      "SELECT count(*)::int AS total FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    assert.equal(activeAfterRecovery.rows[0].total, 0, "Recuperar contraseña debe revocar la sesión global.");
    const oldPasswordLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: multiEmail, password: oldPassword } });
    assert.equal(oldPasswordLogin.response.status, 401);
    const newPasswordLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: multiEmail, password: newPassword } });
    assert.equal(newPasswordLogin.response.status, 200);
    await deliverQueuedAuthMessages(database, smtpPort, encryptionKey);
    const changedPasswordEmail = await getMailpitText(mailpitHttpPort, multiEmail, "Tu contraseña fue cambiada");
    assert.ok(changedPasswordEmail.includes("Administradora de prueba"));

    const logoutRefresh = cookieValue(newPasswordLogin.response, "mvp_refresh");
    const logout = await apiRequest(baseUrl, "/auth/logout", {
      method: "POST",
      cookies: authCookies(logoutRefresh, newPasswordLogin.body.csrfToken),
      csrfToken: newPasswordLogin.body.csrfToken,
    });
    assert.equal(logout.response.status, 204, "Logout debe revocar la sesión y limpiar cookies.");
    const sessionsAfterLogout = await database.query(
      "SELECT count(*)::int AS total FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [multiUserId],
    );
    assert.equal(sessionsAfterLogout.rows[0].total, 0);

    await database.query("DELETE FROM auth_rate_limits");
    const invalidKnownLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: multiEmail, password: "Incorrect Password 2026!" },
    });
    const invalidUnknownLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: `unknown.${marker}@example.test`, password: "Incorrect Password 2026!" },
    });
    assert.equal(invalidKnownLogin.response.status, 401);
    assert.equal(invalidUnknownLogin.response.status, 401);
    assert.deepEqual(
      invalidKnownLogin.body.error,
      { ...invalidUnknownLogin.body.error, requestId: invalidKnownLogin.body.error.requestId },
      "Login no debe revelar si el correo existe aparte del identificador único de solicitud.",
    );
    for (let attempt = 2; attempt < 10; attempt += 1) {
      const repeatedFailure = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: multiEmail, password: "Incorrect Password 2026!" },
      });
      assert.equal(repeatedFailure.response.status, 401);
    }
    const limitedLogin = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: multiEmail, password: "Incorrect Password 2026!" },
    });
    assert.equal(limitedLogin.response.status, 429, "El límite de login debe bloquear intentos adicionales.");
    assert.ok(Number(limitedLogin.response.headers.get("retry-after")) > 0);
    const limiterRows = await database.query("SELECT count(*)::int AS total FROM auth_rate_limits");
    assert.ok(limiterRows.rows[0].total > 0, "El rate limit debe persistir contadores en PostgreSQL.");
    process.stdout.write("TASK-004 auth integration: login concurrente, rotación/replay, multi-tenant, permisos, activación, recuperación y Mailpit correctos.\n");
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

function requireDockerCompose() {
  const result = spawnSync(dockerCommand, ["compose", "version"], {
    cwd: repositoryRoot,
    env: getDockerEnvironment(),
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `No se encontró el ejecutable de Docker (${dockerCommand}). Abre Docker Desktop y reinicia la terminal para actualizar PATH, o define DOCKER_CLI_PATH con la ruta a docker.exe.`,
    );
  }
  if (result.error || result.status !== 0) {
    throw new Error("No se pudo comprobar Docker Compose en este entorno.");
  }
}

try {
  requireDockerCompose();
} catch (error) {
  const message = error instanceof Error ? error.message : "Docker Compose no está disponible.";
  process.stderr.write(`Integración no ejecutada: ${message}\n`);
  process.exit(1);
}

const hostPorts = { postgres: await getAvailablePort() };
do {
  hostPorts.mailpitSmtp = await getAvailablePort();
} while (hostPorts.mailpitSmtp === hostPorts.postgres);
do {
  hostPorts.mailpitHttp = await getAvailablePort();
} while (hostPorts.mailpitHttp === hostPorts.postgres || hostPorts.mailpitHttp === hostPorts.mailpitSmtp);
let server;
let databasePool;
let composeMayExist = false;

try {
  composeMayExist = true;
  runDockerCompose(["up", "--detach", "--wait", "integration-db", "integration-mailpit"], hostPorts);
  await waitForMailpit(hostPorts.mailpitHttp);

  const testDatabaseUrl = `postgresql://mvp_test:mvp_test_password@127.0.0.1:${hostPorts.postgres}/mvp_integration`;
  const migrationEnvironment = {
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test",
    MVP_TEST_DATABASE: "true",
  };
  runNpmScript(["run", "db:migrate:deploy", "--workspace", "@mvp-transporte/api"], migrationEnvironment);
  runNpmScript(["run", "db:seed", "--workspace", "@mvp-transporte/api"], migrationEnvironment);

  const { createApp } = await import("../apps/api/dist/app.js");
  const { createDatabasePool } = await import("../apps/api/dist/database.js");
  databasePool = createDatabasePool(testDatabaseUrl);
  await verifyDataModel(databasePool);
  await verifyAuthentication(databasePool, hostPorts.mailpitSmtp, hostPorts.mailpitHttp, createApp);
  await verifyAuditAndEmail(databasePool, hostPorts.mailpitSmtp, hostPorts.mailpitHttp);
  const app = createApp({
    checkDatabase: async () => {
      await databasePool?.query("SELECT 1");
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolveListen, reject) => {
    server?.once("error", reject);
    server?.once("listening", resolveListen);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/ready`, {
    headers: { connection: "close" },
  });
  assert.equal(response.status, 200, "La API debe informar readiness con PostgreSQL disponible.");
  assert.deepEqual(await response.json(), { status: "ready" });
  process.stdout.write("Integración PostgreSQL/API: correcta.\n");
} finally {
  if (server?.listening) {
    await new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
  await databasePool?.end();
  if (composeMayExist) {
    runDockerCompose(["down", "--remove-orphans"], hostPorts);
  }
}
