import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
  const protectedCatalogs = await database.query(
    `SELECT count(*)::int AS total FROM catalogs WHERE scope = 'GLOBAL' AND is_protected = true
       AND code IN ('EMPLOYEE_DOCUMENT_TYPE', 'EMPLOYEE_POSITION')`,
  );
  assert.equal(protectedCatalogs.rows[0].total, 2, "La migración debe sembrar los catálogos globales protegidos de documentos y cargos.");
  const protectedItems = await database.query(
    `SELECT count(*)::int AS total FROM catalog_items AS item
     JOIN catalogs AS catalog ON catalog.id = item.catalog_id
     WHERE catalog.scope = 'GLOBAL' AND catalog.is_protected = true AND item.status = 'ACTIVE'`,
  );
  assert.equal(protectedItems.rows[0].total, 11, "Los seeds deben incluir tipos de documento y cargos generales.");

  await expectPostgresCode(
    database.query(
      `INSERT INTO catalogs (id, code, name, scope, organization_id, company_id, is_protected, updated_at)
       VALUES ($1::uuid, 'CROSS_TENANT', 'Catálogo inválido', 'COMPANY', $2::uuid, $3::uuid, false, CURRENT_TIMESTAMP)`,
      [randomUUID(), tenantA.organization_id, tenantB.company_id],
    ),
    "23503",
    "La FK compuesta debe impedir asociar un catálogo con una empresa de otro tenant.",
  );
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

async function multipartFileRequest(baseUrl, path, options) {
  const form = new FormData();
  form.append("file", new Blob([options.content], { type: options.mime }), options.filename);
  for (const [name, value] of Object.entries(options.fields ?? {})) form.append(name, value);
  if (options.extraField) form.append("unexpected", options.extraField);
  if (options.extraFile) form.append("extra", new Blob([options.content], { type: options.mime }), "extra.pdf");
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:5173", connection: "close", Authorization: `Bearer ${options.accessToken}` },
    body: form,
  });
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
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

async function verifyRoleManagement(database, createApp, fileStorageRoot) {
  const marker = randomUUID();
  const organizationResult = await database.query(
    "SELECT id FROM organizations WHERE name = 'Tenant de desarrollo A'",
  );
  const companyResult = await database.query(
    "SELECT id FROM companies WHERE organization_id = $1::uuid ORDER BY id LIMIT 1",
    [organizationResult.rows[0].id],
  );
  const branchResult = await database.query(
    "SELECT id FROM branches WHERE company_id = $1::uuid ORDER BY id LIMIT 1",
    [companyResult.rows[0].id],
  );
  assert.ok(organizationResult.rows[0] && companyResult.rows[0] && branchResult.rows[0]);
  const organizationId = organizationResult.rows[0].id;
  const companyId = companyResult.rows[0].id;
  const branchId = branchResult.rows[0].id;
  const otherCompanyId = randomUUID();
  const otherBranchId = randomUUID();
  const deniedBranchId = randomUUID();
  await database.query(
    `INSERT INTO companies (id, organization_id, legal_name, nit, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [otherCompanyId, organizationId, `Otra empresa ${marker}`, `TEST-${marker.slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO branches (id, organization_id, company_id, code, name, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Sucursal de prueba', 'ACTIVE', CURRENT_TIMESTAMP)`,
    [otherBranchId, organizationId, companyId, `OTHER-${marker.slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO branches (id, organization_id, company_id, code, name, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Sucursal sin permiso de prueba', 'ACTIVE', CURRENT_TIMESTAMP)`,
    [deniedBranchId, organizationId, companyId, `DENIED-${marker.slice(0, 8)}`],
  );

  const adminId = randomUUID();
  const adminMembershipId = randomUUID();
  const recipientId = randomUUID();
  const recipientMembershipId = randomUUID();
  const adminEmail = `task005.admin.${marker}@example.test`;
  const recipientEmail = `task005.recipient.${marker}@example.test`;
  const password = "Task 005 Integration Password 2026!";
  const { hashPassword } = await import("../apps/api/dist/modules/auth/auth-crypto.js");
  const passwordHash = await hashPassword(password);
  for (const [id, email, name] of [
    [adminId, adminEmail, "Administración de roles de prueba"],
    [recipientId, recipientEmail, "Membresía de prueba"],
  ]) {
    await database.query(
      `INSERT INTO users (id, normalized_email, display_name, password_hash, status, updated_at)
       VALUES ($1::uuid, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)`,
      [id, email, name, passwordHash],
    );
  }
  await database.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVE', CURRENT_TIMESTAMP),
            ($4::uuid, $2::uuid, $5::uuid, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [adminMembershipId, organizationId, adminId, recipientMembershipId, recipientId],
  );
  const adminRoleResult = await database.query(
    "SELECT id FROM roles WHERE organization_id = $1::uuid AND code = 'admin'",
    [organizationId],
  );
  assert.ok(adminRoleResult.rows[0]);
  const adminAssignmentId = randomUUID();
  await database.query(
    `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION')`,
    [adminAssignmentId, organizationId, adminMembershipId, adminRoleResult.rows[0].id],
  );
  const tenantBResult = await database.query("SELECT id FROM organizations WHERE id <> $1::uuid ORDER BY name LIMIT 1", [organizationId]);
  assert.ok(tenantBResult.rows[0]);
  const tenantBId = tenantBResult.rows[0].id;
  const tenantBAdminId = randomUUID();
  const tenantBMembershipId = randomUUID();
  const tenantBAdminEmail = `task005.admin.b.${marker}@example.test`;
  await database.query(
    `INSERT INTO users (id, normalized_email, display_name, password_hash, status, updated_at)
     VALUES ($1::uuid, $2, 'Administración B de catálogos', $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [tenantBAdminId, tenantBAdminEmail, passwordHash],
  );
  await database.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVE', CURRENT_TIMESTAMP)`,
    [tenantBMembershipId, tenantBId, tenantBAdminId],
  );
  const tenantBAdminRole = await database.query("SELECT id FROM roles WHERE organization_id = $1::uuid AND code = 'admin'", [tenantBId]);
  assert.ok(tenantBAdminRole.rows[0]);
  await database.query(
    `INSERT INTO role_assignments (id, organization_id, membership_id, role_id, scope_type)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORGANIZATION')`,
    [randomUUID(), tenantBId, tenantBMembershipId, tenantBAdminRole.rows[0].id],
  );

  const settings = {
    accessTokenSecret: Buffer.alloc(32, 57).toString("base64"),
    emailPayloadEncryptionKey: Buffer.alloc(32, 61).toString("base64"),
    publicWebUrl: "http://127.0.0.1:5173",
    secureCookies: false,
  };
  const app = createApp({
    database,
    allowedOrigins: ["http://127.0.0.1:5173"],
    fileStorageRoot,
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
    const adminLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: adminEmail, password } });
    assert.equal(adminLogin.response.status, 200);
    const adminToken = adminLogin.body.accessToken;

    const globalCatalogPage = await apiRequest(baseUrl, "/catalogs?limit=100", { accessToken: adminToken });
    assert.equal(globalCatalogPage.response.status, 200);
    const documentCatalog = globalCatalogPage.body.items.find((item) => item.code === "EMPLOYEE_DOCUMENT_TYPE");
    const positionCatalog = globalCatalogPage.body.items.find((item) => item.code === "EMPLOYEE_POSITION");
    assert.ok(documentCatalog && positionCatalog, "La membresía debe consultar los catálogos globales sembrados.");
    assert.equal(documentCatalog.protected, true);
    assert.equal(documentCatalog.canManage, false, "Los catálogos globales se presentan como solo lectura.");
    const documentItems = await apiRequest(baseUrl, `/catalogs/${documentCatalog.id}/items?limit=100&status=ACTIVE`, { accessToken: adminToken });
    assert.equal(documentItems.response.status, 200);
    assert.ok(documentItems.body.items.some((item) => item.code === "IDENTITY_CARD"));
    const protectedCatalogUpdate = await apiRequest(baseUrl, `/catalogs/${documentCatalog.id}`, {
      method: "PATCH", accessToken: adminToken, body: { name: "Intento de cambio" },
    });
    assert.equal(protectedCatalogUpdate.response.status, 403, "Un admin de tenant no puede modificar catálogos globales protegidos.");
    const protectedItemCreate = await apiRequest(baseUrl, `/catalogs/${documentCatalog.id}/items`, {
      method: "POST", accessToken: adminToken, body: { code: "CUSTOM", name: "No permitido" },
    });
    assert.equal(protectedItemCreate.response.status, 403, "Un admin de tenant no puede agregar opciones a catálogos globales protegidos.");

    const sharedCatalogCode = `SCOPED_${marker.slice(0, 8).toUpperCase()}`;
    const organizationCatalog = await apiRequest(baseUrl, "/catalogs", {
      method: "POST", accessToken: adminToken,
      body: { code: sharedCatalogCode, name: "Clasificación del tenant", scope: "ORGANIZATION" },
    });
    assert.equal(organizationCatalog.response.status, 201);
    assert.equal(organizationCatalog.body.canManage, true);
    const organizationCatalogItem = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items`, {
      method: "POST", accessToken: adminToken, body: { code: "cash", name: "Efectivo" },
    });
    assert.equal(organizationCatalogItem.response.status, 201);
    assert.equal(organizationCatalogItem.body.code, "CASH");
    const activeCatalogItem = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items`, {
      method: "POST", accessToken: adminToken, body: { code: "TRANSFER", name: "Transferencia" },
    });
    assert.equal(activeCatalogItem.response.status, 201);
    const duplicateCatalogItem = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items`, {
      method: "POST", accessToken: adminToken, body: { code: "Cash", name: "Duplicado" },
    });
    assert.equal(duplicateCatalogItem.response.status, 409, "Los códigos de opción se normalizan y son únicos dentro del catálogo.");
    const deactivateCatalogItemResult = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items/${organizationCatalogItem.body.id}`, {
      method: "DELETE", accessToken: adminToken,
    });
    assert.equal(deactivateCatalogItemResult.response.status, 204);
    const inactiveCatalogItems = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items?status=INACTIVE`, { accessToken: adminToken });
    assert.equal(inactiveCatalogItems.response.status, 200);
    assert.ok(inactiveCatalogItems.body.items.some((item) => item.id === organizationCatalogItem.body.id && item.status === "INACTIVE"), "Desactivar una opción conserva su ID e historial.");
    const inactiveCatalogItemRows = await database.query("SELECT id, status FROM catalog_items WHERE id = $1::uuid", [organizationCatalogItem.body.id]);
    assert.equal(inactiveCatalogItemRows.rows[0]?.status, "INACTIVE", "La desactivación no borra la fila del catálogo.");
    const deactivateCatalogResult = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(deactivateCatalogResult.response.status, 204);
    const inactiveCatalogRows = await database.query("SELECT id, status FROM catalogs WHERE id = $1::uuid", [organizationCatalog.body.id]);
    assert.equal(inactiveCatalogRows.rows[0]?.status, "INACTIVE", "La desactivación no borra el catálogo.");
    const activeItemsOfInactiveCatalog = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items?status=ACTIVE`, { accessToken: adminToken });
    assert.equal(activeItemsOfInactiveCatalog.response.status, 200);
    assert.equal(activeItemsOfInactiveCatalog.body.total, 0, "Un catálogo inactivo no ofrece opciones para nuevos registros.");

    const companyCatalog = await apiRequest(baseUrl, "/catalogs", {
      method: "POST", accessToken: adminToken,
      body: { code: sharedCatalogCode, name: "Clasificación de empresa", scope: "COMPANY", companyId },
    });
    assert.equal(companyCatalog.response.status, 201, "El mismo código se permite en alcances diferentes.");
    const duplicateCompanyCatalog = await apiRequest(baseUrl, "/catalogs", {
      method: "POST", accessToken: adminToken,
      body: { code: sharedCatalogCode.toLowerCase(), name: "Duplicado de empresa", scope: "COMPANY", companyId },
    });
    assert.equal(duplicateCompanyCatalog.response.status, 409, "El código es único dentro de la empresa y no distingue mayúsculas.");
    const otherCompanyCatalog = await apiRequest(baseUrl, "/catalogs", {
      method: "POST", accessToken: adminToken,
      body: { code: sharedCatalogCode, name: "Clasificación de otra empresa", scope: "COMPANY", companyId: otherCompanyId },
    });
    assert.equal(otherCompanyCatalog.response.status, 201, "Un código puede reutilizarse en otra empresa.");
    const catalogScopeOptions = await apiRequest(baseUrl, "/catalogs/scope-options?limit=100", { accessToken: adminToken });
    assert.equal(catalogScopeOptions.response.status, 200);
    assert.equal(catalogScopeOptions.body.organization, true);
    assert.ok(catalogScopeOptions.body.companies.some((item) => item.id === companyId));

    const tenantBLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: tenantBAdminEmail, password } });
    assert.equal(tenantBLogin.response.status, 200);
    const tenantBToken = tenantBLogin.body.accessToken;
    const fileScopes = await apiRequest(baseUrl, "/files/scope-options?limit=100", { accessToken: adminToken });
    assert.equal(fileScopes.response.status, 200, JSON.stringify(fileScopes.body));
    assert.ok(fileScopes.body.items.some((item) => item.resourceType === "COMPANY_ATTACHMENT" && item.resourceId === companyId));
    assert.ok(fileScopes.body.items.some((item) => item.resourceType === "BRANCH_ATTACHMENT" && item.resourceId === branchId));
    const { resolveFileStorageRoot } = await import("../apps/api/dist/modules/files/file-storage.js");
    assert.throws(() => resolveFileStorageRoot(resolve(repositoryRoot, "apps/web/public")), /fuera de apps\/web\/public/u);
    const pdfContent = Buffer.from("%PDF-1.7\nfixture privado\n%%EOF\n");
    const uploadedCompanyFile = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "factura-prueba.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(uploadedCompanyFile.response.status, 201, `El archivo válido se almacena y enlaza al recurso autorizado: ${JSON.stringify(uploadedCompanyFile.body)}`);
    const companyFileId = uploadedCompanyFile.body.item.id;
    assert.equal(uploadedCompanyFile.body.item.originalName, "factura-prueba.pdf");
    assert.equal(uploadedCompanyFile.body.item.bytes, pdfContent.length);
    const extraFieldUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "extra-campo.pdf", mime: "application/pdf", content: pdfContent, extraField: "rechazado",
    });
    assert.equal(extraFieldUpload.response.status, 400, "La carga rechaza campos adicionales al archivo.");
    const extraFileUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "extra-archivo.pdf", mime: "application/pdf", content: pdfContent, extraFile: true,
    });
    assert.equal(extraFileUpload.response.status, 400, "La carga acepta un solo archivo.");
    const listedCompanyFiles = await apiRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, { accessToken: adminToken });
    assert.equal(listedCompanyFiles.response.status, 200);
    assert.equal(listedCompanyFiles.body.total, 1);
    const companyFileContent = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${companyFileId}/content`, {
      headers: { Authorization: `Bearer ${adminToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(companyFileContent.status, 200);
    assert.equal(companyFileContent.headers.get("content-disposition").startsWith("attachment;"), true);
    assert.deepEqual(Buffer.from(await companyFileContent.arrayBuffer()), pdfContent);
    const foreignFileMetadata = await apiRequest(baseUrl, `/files/${companyFileId}`, { accessToken: tenantBToken });
    assert.equal(foreignFileMetadata.response.status, 404, "Los metadatos de un tenant ajeno no se enumeran.");
    const foreignFileDownload = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${companyFileId}/content`, {
      headers: { Authorization: `Bearer ${tenantBToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(foreignFileDownload.status, 404, "El contenido de un tenant ajeno no se descarga.");
    const foreignResourceUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: tenantBToken, filename: "ajeno.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(foreignResourceUpload.response.status, 404, "No se puede adjuntar a una empresa de otro tenant.");
    const personalDocumentUpload = await multipartFileRequest(baseUrl, `/files?resourceType=EMPLOYEE_DOCUMENT&resourceId=${randomUUID()}`, {
      accessToken: adminToken, filename: "personal.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(personalDocumentUpload.response.status, 400, "Los tipos de enlace no registrados, incluidos documentos personales futuros, se rechazan.");
    const mismatchedMimeUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "imagen.pdf", mime: "application/pdf", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    assert.equal(mismatchedMimeUpload.response.status, 400, "Extensión, MIME declarado y firma real deben coincidir.");
    const unsafeNameUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "../salida.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(unsafeNameUpload.response.status, 400, "Los nombres con traversal se rechazan.");
    const htmlUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "payload.html", mime: "text/html", content: Buffer.from("<html>"),
    });
    assert.equal(htmlUpload.response.status, 400, "HTML y MIME no permitido se rechazan.");
    const oversizedUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: adminToken, filename: "grande.pdf", mime: "application/pdf", content: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41),
    });
    assert.equal(oversizedUpload.response.status, 413, "La API limita el tamaño real a 10 MiB.");
    const invalidPathDownload = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/%2e%2e%2fsecret/content`, {
      headers: { Authorization: `Bearer ${adminToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.ok(invalidPathDownload.status === 400 || invalidPathDownload.status === 404, "La ruta con traversal no llega al filesystem.");
    const uploadedBranchFile = await multipartFileRequest(baseUrl, `/files?resourceType=BRANCH_ATTACHMENT&resourceId=${branchId}`, {
      accessToken: adminToken, filename: "sucursal.png", mime: "image/png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    assert.equal(uploadedBranchFile.response.status, 201);
    const deniedCompanyResource = await apiRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, { accessToken: tenantBToken });
    assert.equal(deniedCompanyResource.response.status, 404);
    const settingScopeOptions = await apiRequest(baseUrl, "/settings/scope-options?limit=100", { accessToken: adminToken });
    assert.equal(settingScopeOptions.response.status, 200);
    assert.ok(settingScopeOptions.body.companies.some((item) => item.id === companyId));
    assert.ok(settingScopeOptions.body.companies.some((item) => item.id === otherCompanyId));
    const companyIdentityA = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: adminToken,
      body: { scopeType: "COMPANY", companyId, key: "identity.name", value: `Empresa A ${marker.slice(0, 8)}` },
    });
    const companyIdentityB = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: adminToken,
      body: { scopeType: "COMPANY", companyId: otherCompanyId, key: "identity.name", value: `Empresa B ${marker.slice(0, 8)}` },
    });
    assert.equal(companyIdentityA.response.status, 200);
    assert.equal(companyIdentityB.response.status, 200, "La configuración de identidad se separa por empresa.");
    const effectiveCompanyA = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}`, { accessToken: adminToken });
    const effectiveCompanyB = await apiRequest(baseUrl, `/settings/effective?companyId=${otherCompanyId}`, { accessToken: adminToken });
    const effectiveIdentityA = effectiveCompanyA.body.items.find((item) => item.key === "identity.name");
    const effectiveIdentityB = effectiveCompanyB.body.items.find((item) => item.key === "identity.name");
    assert.equal(effectiveIdentityA.value, companyIdentityA.body.item.value);
    assert.notEqual(effectiveIdentityA.value, effectiveIdentityB.value, "Dos empresas deben resolver identidades independientes.");
    assert.equal(effectiveIdentityA.sourceScopeType, "COMPANY");
    const organizationLocale = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: adminToken, body: { scopeType: "ORGANIZATION", key: "locale", value: "es" },
    });
    assert.equal(organizationLocale.response.status, 200);
    assert.equal(effectiveCompanyA.body.target.scopeType, "COMPANY");
    const refreshedEffectiveCompanyA = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}`, { accessToken: adminToken });
    assert.equal(refreshedEffectiveCompanyA.body.items.find((item) => item.key === "locale").sourceScopeType, "ORGANIZATION", "La configuración efectiva debe heredar de organización a empresa.");
    const invalidCurrency = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: adminToken, body: { scopeType: "COMPANY", companyId, key: "currency", value: "USD" },
    });
    assert.equal(invalidCurrency.response.status, 400, "Los valores fuera de la lista permitida se rechazan.");
    const invalidSettingKey = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: adminToken, body: { scopeType: "COMPANY", companyId, key: "smtp.password", value: "secret" },
    });
    assert.equal(invalidSettingKey.response.status, 400, "No se acepta una clave de configuración secreta o desconocida.");
    const tenantCannotReadInstallation = await apiRequest(baseUrl, "/settings/installation", { accessToken: adminToken });
    assert.equal(tenantCannotReadInstallation.response.status, 403, "SMTP y configuración de instalación están fuera del acceso del tenant.");
    const foreignCompanySetting = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}`, { accessToken: tenantBToken });
    assert.equal(foreignCompanySetting.response.status, 404, "La configuración de una empresa ajena no debe poder enumerarse.");
    const tenantBCompany = await database.query("SELECT id FROM companies WHERE organization_id = (SELECT id FROM organizations WHERE id <> $1::uuid ORDER BY name LIMIT 1) ORDER BY id LIMIT 1", [organizationId]);
    assert.ok(tenantBCompany.rows[0]);
    const tenantBIdentity = await apiRequest(baseUrl, "/settings", {
      method: "PUT", accessToken: tenantBToken,
      body: { scopeType: "COMPANY", companyId: tenantBCompany.rows[0].id, key: "identity.name", value: `Empresa B tenant ${marker.slice(0, 8)}` },
    });
    assert.equal(tenantBIdentity.response.status, 200, "Otro tenant puede guardar su propia configuración.");

    const companyHours = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      intervals: index === 0 ? [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] : [],
    }));
    const savedCompanyHours = await apiRequest(baseUrl, "/settings/business-hours", {
      method: "PUT", accessToken: adminToken, body: { companyId, days: companyHours },
    });
    assert.equal(savedCompanyHours.response.status, 200);
    const inheritedBranchHours = await apiRequest(baseUrl, `/settings/business-hours?companyId=${companyId}&branchId=${branchId}`, { accessToken: adminToken });
    assert.equal(inheritedBranchHours.response.status, 200);
    assert.equal(inheritedBranchHours.body.items[0].sourceScopeType, "COMPANY", "El horario de sucursal hereda inicialmente el de empresa.");
    const overlappingHours = structuredClone(companyHours);
    overlappingHours[0].intervals[1] = { start: "11:30", end: "15:00" };
    const rejectedHours = await apiRequest(baseUrl, "/settings/business-hours", {
      method: "PUT", accessToken: adminToken, body: { companyId, days: overlappingHours },
    });
    assert.equal(rejectedHours.response.status, 400, "Los intervalos solapados se rechazan.");
    const branchHours = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      intervals: index === 0 ? [{ start: "10:00", end: "16:00" }] : [],
    }));
    const savedBranchHours = await apiRequest(baseUrl, "/settings/business-hours", {
      method: "PUT", accessToken: adminToken, body: { companyId, branchId, days: branchHours },
    });
    assert.equal(savedBranchHours.response.status, 200);
    const branchHoursAfter = await apiRequest(baseUrl, `/settings/business-hours?companyId=${companyId}&branchId=${branchId}`, { accessToken: adminToken });
    assert.equal(branchHoursAfter.body.items[0].sourceScopeType, "BRANCH");
    assert.deepEqual(branchHoursAfter.body.items[0].intervals, [{ start: "10:00", end: "16:00" }]);
    const companyHoursAfter = await apiRequest(baseUrl, `/settings/business-hours?companyId=${companyId}`, { accessToken: adminToken });
    assert.deepEqual(companyHoursAfter.body.items[0].intervals, companyHours[0].intervals, "El override de sucursal no debe modificar a la empresa.");

    const sequence = await apiRequest(baseUrl, "/settings/number-sequences", {
      method: "POST", accessToken: adminToken,
      body: { companyId, documentType: "invoice", period: "2026-10", prefix: "FAC-", padding: 6 },
    });
    assert.equal(sequence.response.status, 201);
    assert.equal(sequence.body.documentType, "INVOICE");
    const invalidSequencePeriod = await apiRequest(baseUrl, "/settings/number-sequences", {
      method: "POST", accessToken: adminToken,
      body: { companyId, documentType: "INVOICE", period: "2026-13", prefix: "FAC-", padding: 6 },
    });
    assert.equal(invalidSequencePeriod.response.status, 400);
    const independentSequence = await apiRequest(baseUrl, "/settings/number-sequences", {
      method: "POST", accessToken: adminToken,
      body: { companyId: otherCompanyId, documentType: "INVOICE", period: "2026-10", prefix: "OTR-", padding: 4 },
    });
    assert.equal(independentSequence.response.status, 201, "El mismo documento y período se permiten en otra empresa.");
    const concurrentNumbers = await Promise.all(Array.from({ length: 12 }, () => apiRequest(baseUrl, `/settings/number-sequences/${sequence.body.id}/next`, { method: "POST", accessToken: adminToken, body: {} })));
    assert.ok(concurrentNumbers.every((result) => result.response.status === 200), "La numeración concurrente debe completar todas las emisiones.");
    const issuedNumbers = concurrentNumbers.map((result) => result.body.number);
    assert.equal(new Set(issuedNumbers).size, 12, "La emisión concurrente no debe duplicar números.");
    assert.ok(issuedNumbers.every((number) => /^INVOICE-FAC-2026-10-\d{6}$/u.test(number)));
    const sequenceAfterIssue = await apiRequest(baseUrl, `/settings/number-sequences?companyId=${companyId}`, { accessToken: adminToken });
    assert.equal(sequenceAfterIssue.body.items.find((item) => item.id === sequence.body.id).nextValue, "13");
    const immutableSequence = await apiRequest(baseUrl, `/settings/number-sequences/${sequence.body.id}`, {
      method: "PATCH", accessToken: adminToken, body: { prefix: "CAMBIADO-" },
    });
    assert.equal(immutableSequence.response.status, 409, "No se debe modificar el formato tras la primera emisión.");
    const tenantBCatalog = await apiRequest(baseUrl, "/catalogs", {
      method: "POST", accessToken: tenantBToken,
      body: { code: sharedCatalogCode, name: "Clasificación del tenant B", scope: "ORGANIZATION" },
    });
    assert.equal(tenantBCatalog.response.status, 201, "La unicidad de códigos no se extiende a otros tenants.");
    const crossTenantCatalogRead = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items`, { accessToken: tenantBToken });
    assert.equal(crossTenantCatalogRead.response.status, 404, "Un tenant no puede leer opciones de catálogos ajenos.");
    const tenantBCatalogList = await apiRequest(baseUrl, "/catalogs?limit=100", { accessToken: tenantBToken });
    assert.equal(tenantBCatalogList.response.status, 200);
    assert.ok(!tenantBCatalogList.body.items.some((item) => item.id === organizationCatalog.body.id), "El listado no debe revelar catálogos de otros tenants.");

    const companyCreated = await apiRequest(baseUrl, "/organizations/companies", {
      method: "POST", accessToken: adminToken,
      body: { legalName: `TASK-006 Empresa ${marker}`, tradeName: "Sucursal Central", nit: `NIT-${marker.slice(0, 8)}`, contact: "administracion@example.test", address: "Calle 1" },
    });
    assert.equal(companyCreated.response.status, 201, "El tenant admin debe crear una empresa en su organización.");
    const companyIdCreated = companyCreated.body.id;
    const companyPage = await apiRequest(baseUrl, `/organizations/companies?limit=100&search=${encodeURIComponent(marker)}`, { accessToken: adminToken });
    assert.equal(companyPage.response.status, 200);
    assert.ok(companyPage.body.items.some((item) => item.id === companyIdCreated));
    const companyUpdated = await apiRequest(baseUrl, `/organizations/companies/${companyIdCreated}`, {
      method: "PATCH", accessToken: adminToken, body: { tradeName: "Centro actualizado", contact: null },
    });
    assert.equal(companyUpdated.response.status, 200);
    assert.equal(companyUpdated.body.tradeName, "Centro actualizado");
    assert.equal(companyUpdated.body.contact, null);

    const branchCreated = await apiRequest(baseUrl, `/organizations/companies/${companyIdCreated}/branches`, {
      method: "POST", accessToken: adminToken, body: { code: "hq", name: "Casa matriz", address: "Avenida 2" },
    });
    assert.equal(branchCreated.response.status, 201);
    assert.equal(branchCreated.body.code, "HQ", "Los códigos de sucursal se normalizan para aplicar unicidad sin distinción de mayúsculas.");
    const duplicateBranch = await apiRequest(baseUrl, `/organizations/companies/${companyIdCreated}/branches`, {
      method: "POST", accessToken: adminToken, body: { code: "hQ", name: "Duplicada" },
    });
    assert.equal(duplicateBranch.response.status, 409, "Un código de sucursal no debe duplicarse dentro de la empresa.");
    const sameCodeOtherCompany = await apiRequest(baseUrl, `/organizations/companies/${otherCompanyId}/branches`, {
      method: "POST", accessToken: adminToken, body: { code: "hq", name: "Casa matriz de otra empresa" },
    });
    assert.equal(sameCodeOtherCompany.response.status, 201, "El mismo código puede utilizarse en otra empresa del tenant.");
    const branchUpdated = await apiRequest(baseUrl, `/organizations/branches/${branchCreated.body.id}`, {
      method: "PATCH", accessToken: adminToken, body: { code: "south", name: "Sucursal Sur" },
    });
    assert.equal(branchUpdated.response.status, 200);
    assert.equal(branchUpdated.body.code, "SOUTH");
    const branchPage = await apiRequest(baseUrl, `/organizations/branches?companyId=${companyIdCreated}&limit=100`, { accessToken: adminToken });
    assert.equal(branchPage.response.status, 200);
    assert.ok(branchPage.body.items.some((item) => item.id === branchCreated.body.id));
    const deactivateBranch = await apiRequest(baseUrl, `/organizations/branches/${branchCreated.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(deactivateBranch.response.status, 204);
    const reactivateBranch = await apiRequest(baseUrl, `/organizations/branches/${branchCreated.body.id}`, { method: "PATCH", accessToken: adminToken, body: { status: "ACTIVE" } });
    assert.equal(reactivateBranch.response.status, 200);
    const deactivateCompany = await apiRequest(baseUrl, `/organizations/companies/${companyIdCreated}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(deactivateCompany.response.status, 204);
    const reactivateCompany = await apiRequest(baseUrl, `/organizations/companies/${companyIdCreated}`, { method: "PATCH", accessToken: adminToken, body: { status: "ACTIVE" } });
    assert.equal(reactivateCompany.response.status, 200);

    const otherOrganization = await database.query("SELECT id FROM organizations WHERE id <> $1::uuid ORDER BY name LIMIT 1", [organizationId]);
    assert.ok(otherOrganization.rows[0], "La integración debe tener un segundo tenant para probar aislamiento.");
    const foreignCompanyId = randomUUID();
    const foreignBranchId = randomUUID();
    await database.query(
      `INSERT INTO companies (id, organization_id, legal_name, nit, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)`,
      [foreignCompanyId, otherOrganization.rows[0].id, `TASK-006 Empresa ajena ${marker}`, `FOREIGN-${marker.slice(0, 8)}`],
    );
    await database.query(
      `INSERT INTO branches (id, organization_id, company_id, code, name, status, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Sucursal ajena', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [foreignBranchId, otherOrganization.rows[0].id, foreignCompanyId, `FOREIGN-${marker.slice(0, 8)}`],
    );
    const foreignCompanyWrite = await apiRequest(baseUrl, `/organizations/companies/${foreignCompanyId}`, { method: "PATCH", accessToken: adminToken, body: { legalName: "Cambio ajeno" } });
    assert.equal(foreignCompanyWrite.response.status, 404, "Un ID de otro tenant no debe permitir leer ni alterar la empresa.");
    const foreignBranchWrite = await apiRequest(baseUrl, `/organizations/branches/${foreignBranchId}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(foreignBranchWrite.response.status, 404, "Un ID de otro tenant no debe permitir alterar la sucursal.");
    const foreignBranchCreate = await apiRequest(baseUrl, `/organizations/companies/${foreignCompanyId}/branches`, { method: "POST", accessToken: adminToken, body: { code: "X", name: "No permitido" } });
    assert.equal(foreignBranchCreate.response.status, 404, "No se puede crear una sucursal bajo una empresa de otro tenant.");
    const companiesAfterForeignInsert = await apiRequest(baseUrl, `/organizations/companies?limit=100&search=${encodeURIComponent(marker)}`, { accessToken: adminToken });
    assert.equal(companiesAfterForeignInsert.response.status, 200);
    assert.ok(companiesAfterForeignInsert.body.items.some((item) => item.id === companyIdCreated));
    assert.ok(!companiesAfterForeignInsert.body.items.some((item) => item.id === foreignCompanyId), "El listado del tenant no debe revelar empresas de otro tenant.");
    const branchesAfterForeignInsert = await apiRequest(baseUrl, `/organizations/branches?limit=100&search=${encodeURIComponent(marker)}`, { accessToken: adminToken });
    assert.equal(branchesAfterForeignInsert.response.status, 200);
    assert.ok(!branchesAfterForeignInsert.body.items.some((item) => item.id === foreignBranchId), "El listado del tenant no debe revelar sucursales de otro tenant.");
    const foreignRowsAfter = await database.query(
      `SELECT company.legal_name, branch.status FROM companies AS company JOIN branches AS branch ON branch.company_id = company.id WHERE company.id = $1::uuid`,
      [foreignCompanyId],
    );
    assert.equal(foreignRowsAfter.rows[0].legal_name, `TASK-006 Empresa ajena ${marker}`);
    assert.equal(foreignRowsAfter.rows[0].status, "ACTIVE");
    const platformListForbidden = await apiRequest(baseUrl, "/platform/organizations", { accessToken: adminToken });
    assert.equal(platformListForbidden.response.status, 403, "Un admin de tenant no debe consultar tenants desde plataforma.");

    const catalog = await apiRequest(baseUrl, "/organizations/roles/permissions", { accessToken: adminToken });
    assert.equal(catalog.response.status, 200);
    assert.ok(catalog.body.some((item) => item.code === "roles.assign"));
    assert.ok(catalog.body.every((item) => !item.code.startsWith("organizations.")));
    const rolesPage = await apiRequest(baseUrl, "/organizations/roles?limit=2&offset=0", { accessToken: adminToken });
    assert.equal(rolesPage.response.status, 200);
    assert.equal(rolesPage.body.limit, 2);
    const membershipsPage = await apiRequest(baseUrl, "/organizations/role-assignment-options?kind=memberships&limit=2", { accessToken: adminToken });
    assert.equal(membershipsPage.response.status, 200);
    assert.equal(membershipsPage.body.limit, 2);

    async function createRole(name, permissionCodes) {
      const result = await apiRequest(baseUrl, "/organizations/roles", {
        method: "POST", accessToken: adminToken, body: { name, permissionCodes },
      });
      assert.equal(result.response.status, 201, `El rol '${name}' debe crearse.`);
      return result.body;
    }
    const organizationReader = await createRole(`Lectura de tenant ${marker}`, ["catalogs.read"]);
    const companyReader = await createRole(`Lectura de empresa ${marker}`, ["companies.read", "catalogs.read"]);
    const branchReader = await createRole(`Lectura de sucursal ${marker}`, ["branches.read"]);
    const branchManager = await createRole(`Gestión de sucursal ${marker}`, ["roles.assign"]);
    const usersReader = await createRole(`Lectura de usuarios ${marker}`, ["users.read"]);
    const invalidPlatformRole = await apiRequest(baseUrl, "/organizations/roles", {
      method: "POST", accessToken: adminToken, body: { name: "Sin permisos de plataforma", permissionCodes: ["organizations.create"] },
    });
    assert.equal(invalidPlatformRole.response.status, 400, "Los roles de tenant no pueden incluir permisos de plataforma.");

    async function assign(input) {
      return apiRequest(baseUrl, "/organizations/role-assignments", { method: "POST", accessToken: adminToken, body: input });
    }
    const organizationAssignment = await assign({ membershipId: recipientMembershipId, roleId: organizationReader.id, scopeType: "ORGANIZATION" });
    assert.equal(organizationAssignment.response.status, 201);
    const companyAssignment = await assign({ membershipId: recipientMembershipId, roleId: companyReader.id, scopeType: "COMPANY", companyId });
    assert.equal(companyAssignment.response.status, 201);
    const branchAssignment = await assign({ membershipId: recipientMembershipId, roleId: branchReader.id, scopeType: "BRANCH", companyId, branchId });
    assert.equal(branchAssignment.response.status, 201);
    const managerAssignment = await assign({ membershipId: recipientMembershipId, roleId: branchManager.id, scopeType: "BRANCH", companyId, branchId });
    assert.equal(managerAssignment.response.status, 201);
    const otherTenantMembership = await database.query(
      `SELECT membership.id, membership.organization_id FROM organization_memberships AS membership
       JOIN organizations AS organization ON organization.id = membership.organization_id
       WHERE organization.name = 'Tenant de desarrollo B' LIMIT 1`,
    );
    assert.ok(otherTenantMembership.rows[0]);
    const crossTenantAssignment = await assign({
      membershipId: otherTenantMembership.rows[0].id, roleId: companyReader.id, scopeType: "COMPANY", companyId,
    });
    assert.equal(crossTenantAssignment.response.status, 404, "Una membresía de otro tenant debe ser inaccesible.");

    const { hasPermission, resolveAccessContext } = await import("../apps/api/dist/modules/access/access-context.js");
    const recipientContext = await resolveAccessContext(database, recipientId, organizationId);
    assert.ok(recipientContext);
    assert.equal(hasPermission(recipientContext, "catalogs.read", { organizationId }), true);
    assert.equal(hasPermission(recipientContext, "catalogs.read", { organizationId: otherTenantMembership.rows[0].organization_id }), false);
    assert.equal(hasPermission(recipientContext, "companies.read", { organizationId, companyId }), true);
    assert.equal(hasPermission(recipientContext, "companies.read", { organizationId, companyId: otherCompanyId }), false);
    assert.equal(hasPermission(recipientContext, "branches.read", { organizationId, companyId, branchId }), true);
    assert.equal(hasPermission(recipientContext, "branches.read", { organizationId, companyId, branchId: otherBranchId }), false);
    assert.equal(hasPermission(recipientContext, "branches.read", { organizationId, companyId }), false, "Un permiso de sucursal no debe ampliar al resto de la empresa.");

    const recipientLogin = await apiRequest(baseUrl, "/auth/login", { method: "POST", body: { email: recipientEmail, password } });
    assert.equal(recipientLogin.response.status, 200);
    const recipientToken = recipientLogin.body.accessToken;
    const deniedAuditRead = await apiRequest(baseUrl, "/audit", { accessToken: recipientToken });
    assert.equal(deniedAuditRead.response.status, 403, "La membresía sin audit.read no puede consultar eventos.");
    const recipientMe = await apiRequest(baseUrl, "/auth/me", { accessToken: recipientToken });
    assert.equal(recipientMe.response.status, 200);
    assert.ok(recipientMe.body.permissions.includes("roles.assign"));
    assert.ok(recipientMe.body.permissions.includes("companies.read"));
    const employeeWithoutRead = await apiRequest(baseUrl, "/employees?limit=100", { accessToken: recipientToken });
    assert.equal(employeeWithoutRead.response.status, 403, "Vincular una cuenta no concede por sí solo acceso al módulo de personal.");
    const linkedEmployee = await apiRequest(baseUrl, "/employees", {
      method: "POST", accessToken: adminToken,
      body: {
        companyId, internalCode: `EMP-${marker.slice(0, 8)}`, firstNames: "María Elena", lastNames: "Prueba Integración",
        personalDocumentNumber: `CI-${marker.slice(0, 8)}`, personalPhone: "+59170000000", personalEmail: `empleada.${marker}@example.test`,
        personalAddress: "Dirección privada de integración", positionId: "00000000-0000-4000-8000-000000000724",
        hireDate: "2026-01-15", branchIds: [branchId, otherBranchId], userId: recipientId,
      },
    });
    assert.equal(linkedEmployee.response.status, 201, `Un empleado con cuenta opcional debe crearse: ${JSON.stringify(linkedEmployee.body)}`);
    const linkedEmployeeId = linkedEmployee.body.item.id;
    assert.equal(linkedEmployee.body.item.personalData.documentNumber, `CI-${marker.slice(0, 8)}`, "El administrador con permiso personal puede consultar identidad.");
    const employeeWithoutUser = await apiRequest(baseUrl, "/employees", {
      method: "POST", accessToken: adminToken,
      body: { companyId, internalCode: `NOUSER-${marker.slice(0, 8)}`, firstNames: "Persona", lastNames: "Sin Cuenta", hireDate: "2026-02-01", branchIds: [otherBranchId] },
    });
    assert.equal(employeeWithoutUser.response.status, 201, "Un empleado puede existir sin identidad de usuario.");
    const wrongTenantUserLink = await apiRequest(baseUrl, "/employees", {
      method: "POST", accessToken: adminToken,
      body: { companyId, internalCode: `FOREIGN-${marker.slice(0, 8)}`, firstNames: "Cuenta", lastNames: "Ajena", hireDate: "2026-02-01", branchIds: [branchId], userId: tenantBAdminId },
    });
    assert.equal(wrongTenantUserLink.response.status, 400, "No se puede asociar una identidad que no pertenece a la organización.");
    const employeeReader = await createRole(`Consulta de personal ${marker}`, ["employees.read", "employees.update"]);
    const employeeReaderAssignment = await assign({ membershipId: recipientMembershipId, roleId: employeeReader.id, scopeType: "BRANCH", companyId, branchId });
    assert.equal(employeeReaderAssignment.response.status, 201);
    const branchEmployees = await apiRequest(baseUrl, `/employees?limit=100&companyId=${companyId}`, { accessToken: recipientToken });
    assert.equal(branchEmployees.response.status, 200);
    assert.ok(branchEmployees.body.items.some((employee) => employee.id === linkedEmployeeId), "El visor con cuenta puede consultar al empleado de su sucursal.");
    assert.ok(!branchEmployees.body.items.some((employee) => employee.id === employeeWithoutUser.body.item.id), "Una autorización de sucursal no lista empleados de otra sucursal.");
    const branchEmployeeDetail = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { accessToken: recipientToken });
    assert.equal(branchEmployeeDetail.response.status, 200);
    assert.equal(Object.hasOwn(branchEmployeeDetail.body.item, "personalData"), false, "La lista y el detalle del supervisor no exponen identificación personal por defecto.");
    assert.equal(Object.hasOwn(branchEmployeeDetail.body.item, "linkedUser"), false, "El detalle no expone la identidad vinculada sin permiso personal.");
    assert.deepEqual(branchEmployeeDetail.body.item.branches.map((item) => item.id), [branchId], "Solo se devuelve la asignación de sucursal autorizada.");
    const branchCannotChangeSharedIdentity = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { method: "PATCH", accessToken: recipientToken, body: { firstNames: "Cambio global denegado" } });
    assert.equal(branchCannotChangeSharedIdentity.response.status, 403, "Un permiso de sucursal no altera los datos laborales compartidos de toda la empresa.");
    const branchAssignmentUpdate = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { method: "PATCH", accessToken: recipientToken, body: { branchIds: [branchId] } });
    assert.equal(branchAssignmentUpdate.response.status, 200, "El permiso de sucursal puede administrar su propia asignación.");
    const preservedOtherBranch = await database.query("SELECT count(*)::int AS total FROM employee_branch_assignments WHERE employee_id = $1::uuid AND branch_id = $2::uuid", [linkedEmployeeId, otherBranchId]);
    assert.equal(preservedOtherBranch.rows[0].total, 1, "Actualizar la asignación propia no elimina una sucursal que el actor no puede administrar.");
    const personalDataEditorRole = await createRole(`Editor de datos personales sin users.read ${marker}`, ["employees.read", "employees.update", "employees.personal.read"]);
    const personalDataEditorAssignment = await assign({ membershipId: recipientMembershipId, roleId: personalDataEditorRole.id, scopeType: "COMPANY", companyId });
    assert.equal(personalDataEditorAssignment.response.status, 201);
    const unauthorizedUserUnlink = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { method: "PATCH", accessToken: recipientToken, body: { userId: null } });
    assert.equal(unauthorizedUserUnlink.response.status, 403, "Quitar un vínculo también requiere users.read.");
    const linkedIdentityAfterDeniedUnlink = await database.query("SELECT user_id FROM employees WHERE id = $1::uuid", [linkedEmployeeId]);
    assert.equal(linkedIdentityAfterDeniedUnlink.rows[0]?.user_id, recipientId, "Un actor sin users.read no puede borrar silenciosamente el vínculo existente.");
    const removePersonalDataEditor = await apiRequest(baseUrl, `/organizations/role-assignments/${personalDataEditorAssignment.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(removePersonalDataEditor.response.status, 204, "La fixture amplia se retira después de probar la protección del vínculo.");
    const employeeDocumentTypeId = documentItems.body.items.find((item) => item.code === "IDENTITY_CARD").id;
    const employeeDocument = await multipartFileRequest(baseUrl, `/employees/${linkedEmployeeId}/documents`, {
      accessToken: adminToken, filename: "identidad.pdf", mime: "application/pdf", content: pdfContent,
      fields: { typeId: employeeDocumentTypeId, issuedAt: "2025-01-01", expiresAt: "2030-01-01" },
    });
    assert.equal(employeeDocument.response.status, 201, `El administrador puede cargar un documento privado: ${JSON.stringify(employeeDocument.body)}`);
    const employeePhotoContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const employeePhoto = await multipartFileRequest(baseUrl, `/employees/${linkedEmployeeId}/photo`, {
      accessToken: adminToken, filename: "foto.png", mime: "image/png", content: employeePhotoContent,
    });
    assert.equal(employeePhoto.response.status, 201, `El administrador puede cargar una foto privada: ${JSON.stringify(employeePhoto.body)}`);
    const recipientEmployeeDocs = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}/documents`, { accessToken: recipientToken });
    assert.equal(recipientEmployeeDocs.response.status, 403, "employees.read no concede employee_documents.read.");
    const deniedFileList = await apiRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, { accessToken: recipientToken });
    assert.equal(deniedFileList.response.status, 403, "Una cuenta sin permiso files.read no puede listar archivos.");
    const deniedFileUpload = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: recipientToken, filename: "sin-permiso.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(deniedFileUpload.response.status, 403, "Una cuenta sin permiso files.upload no puede iniciar la carga.");
    const genericFilesRole = await createRole(`Permisos genéricos de archivos ${marker}`, ["files.read", "files.upload", "files.download"]);
    const genericFilesAssignment = await assign({ membershipId: recipientMembershipId, roleId: genericFilesRole.id, scopeType: "ORGANIZATION" });
    assert.equal(genericFilesAssignment.response.status, 201);
    const genericFilesCannotDownloadEmployeeDocument = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${employeeDocument.body.item.id}/content`, {
      headers: { Authorization: `Bearer ${recipientToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(genericFilesCannotDownloadEmployeeDocument.status, 403, "files.download no reemplaza employee_documents.read para documentos personales.");
    const genericFilesCannotDownloadPhoto = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${employeePhoto.body.item.id}/content`, {
      headers: { Authorization: `Bearer ${recipientToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(genericFilesCannotDownloadPhoto.status, 403, "files.download no reemplaza employees.personal.read para fotos personales.");
    const employeeSupervisor = await createRole(`Supervisor laboral ${marker}`, [
      "employees.read", "employees.create", "employees.update", "catalogs.read",
      "files.upload", "files.read", "files.download", "notifications.read",
    ]);
    const employeeSupervisorAssignment = await assign({ membershipId: recipientMembershipId, roleId: employeeSupervisor.id, scopeType: "BRANCH", companyId, branchId });
    assert.equal(employeeSupervisorAssignment.response.status, 201);
    const supervisorEmployeeDetails = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { accessToken: recipientToken });
    assert.equal(supervisorEmployeeDetails.response.status, 200);
    assert.equal(supervisorEmployeeDetails.body.item.canReadPersonalData, false);
    assert.equal(supervisorEmployeeDetails.body.item.canReadDocuments, false);
    assert.equal(Object.hasOwn(supervisorEmployeeDetails.body.item, "personalData"), false, "El supervisor de empresa sigue sin recibir identificación, contacto ni domicilio.");
    assert.equal(Object.hasOwn(supervisorEmployeeDetails.body.item, "photoFileId"), false, "El supervisor no recibe el ID de la foto personal.");
    const supervisorEmployeeDocs = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}/documents`, { accessToken: recipientToken });
    assert.equal(supervisorEmployeeDocs.response.status, 403, "El supervisor no recibe documentos personales por defecto.");
    const removeEmployeeSupervisor = await apiRequest(baseUrl, `/organizations/role-assignments/${employeeSupervisorAssignment.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(removeEmployeeSupervisor.response.status, 204, "La fixture de supervisor se retira después de probar sus permisos ADM-05.");
    const removeEmployeeReader = await apiRequest(baseUrl, `/organizations/role-assignments/${employeeReaderAssignment.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(removeEmployeeReader.response.status, 204, "La fixture de lectura de personal se retira después de probar el alcance de sucursal.");
    const adminEmployeeDocs = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}/documents`, { accessToken: adminToken });
    assert.equal(adminEmployeeDocs.response.status, 200);
    assert.equal(adminEmployeeDocs.body.items.length, 1);
    assert.equal(adminEmployeeDocs.body.items[0].type.code, "IDENTITY_CARD");
    const inactiveEmployee = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { method: "PATCH", accessToken: adminToken, body: { status: "INACTIVE" } });
    assert.equal(inactiveEmployee.response.status, 200, "El administrador puede desactivar un empleado.");
    assert.equal(inactiveEmployee.body.item.status, "INACTIVE");
    const inactiveEmployeePhotoUpload = await multipartFileRequest(baseUrl, `/employees/${linkedEmployeeId}/photo`, {
      accessToken: adminToken, filename: "inactivo.png", mime: "image/png", content: employeePhotoContent,
    });
    assert.equal(inactiveEmployeePhotoUpload.response.status, 409, "El empleado inactivo no admite cambios en sus archivos.");
    const reactivatedEmployee = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}`, { method: "PATCH", accessToken: adminToken, body: { status: "ACTIVE" } });
    assert.equal(reactivatedEmployee.response.status, 200);
    const deleteEmployeeDocument = await apiRequest(baseUrl, `/files/${employeeDocument.body.item.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(deleteEmployeeDocument.response.status, 204, "El documento se puede retirar tras autorización específica.");
    const employeeDocumentsAfterDelete = await apiRequest(baseUrl, `/employees/${linkedEmployeeId}/documents`, { accessToken: adminToken });
    assert.equal(employeeDocumentsAfterDelete.body.items.length, 0, "Retirar el archivo también elimina su fila de metadatos.");
    const genericFilesCannotCrossResourcePolicy = await apiRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${otherCompanyId}`, { accessToken: recipientToken });
    assert.equal(genericFilesCannotCrossResourcePolicy.response.status, 403, "files.read por sí solo no sustituye companies.read del recurso.");
    const scopedCompanies = await apiRequest(baseUrl, "/organizations/companies?limit=100", { accessToken: recipientToken });
    assert.equal(scopedCompanies.response.status, 200);
    assert.deepEqual(scopedCompanies.body.items.map((item) => item.id), [companyId], "Una autorización de empresa solo lista esa empresa.");
    const scopedBranches = await apiRequest(baseUrl, `/organizations/branches?companyId=${companyId}&limit=100`, { accessToken: recipientToken });
    assert.equal(scopedBranches.response.status, 200);
    assert.deepEqual(scopedBranches.body.items.map((item) => item.id), [branchId], "Una autorización de sucursal solo lista esa sucursal.");
    const settingsBeforeGrant = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}`, { accessToken: recipientToken });
    assert.equal(settingsBeforeGrant.response.status, 403, "Una cuenta sin settings.read no consulta configuración.");
    const branchSettingsRole = await createRole(`Gestión de configuración de sucursal ${marker}`, ["settings.read", "settings.update"]);
    const branchSettingsAssignment = await assign({ membershipId: recipientMembershipId, roleId: branchSettingsRole.id, scopeType: "BRANCH", companyId, branchId: otherBranchId });
    assert.equal(branchSettingsAssignment.response.status, 201);
    const settingsScopeOptions = await apiRequest(baseUrl, "/settings/scope-options?limit=100", { accessToken: recipientToken });
    assert.equal(settingsScopeOptions.response.status, 200);
    const scopedSettingCompany = settingsScopeOptions.body.companies.find((item) => item.id === companyId);
    assert.ok(scopedSettingCompany);
    assert.equal(scopedSettingCompany.canRead, false, "El permiso de sucursal no se amplía a la empresa.");
    assert.deepEqual(scopedSettingCompany.branches.map((item) => item.id), [otherBranchId], "Las opciones de configuración incluyen solo sucursales autorizadas.");
    const settingsAtCompany = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}`, { accessToken: recipientToken });
    assert.equal(settingsAtCompany.response.status, 403, "Una autorización de configuración de sucursal no habilita el ámbito empresa.");
    const settingsAtAllowedBranch = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}&branchId=${otherBranchId}`, { accessToken: recipientToken });
    assert.equal(settingsAtAllowedBranch.response.status, 200);
    const settingsAtOtherBranch = await apiRequest(baseUrl, `/settings/effective?companyId=${companyId}&branchId=${branchId}`, { accessToken: recipientToken });
    assert.equal(settingsAtOtherBranch.response.status, 403, "La configuración de otra sucursal sigue denegada.");
    const settingsAtOtherCompany = await apiRequest(baseUrl, `/settings/effective?companyId=${otherCompanyId}`, { accessToken: recipientToken });
    assert.equal(settingsAtOtherCompany.response.status, 403, "El permiso de sucursal no habilita otra empresa.");
    const fileBranchRole = await createRole(`Archivos de sucursal ${marker}`, ["files.read", "files.upload", "files.download", "files.delete", "branches.read", "branches.update"]);
    const fileBranchAssignment = await assign({ membershipId: recipientMembershipId, roleId: fileBranchRole.id, scopeType: "BRANCH", companyId, branchId: otherBranchId });
    assert.equal(fileBranchAssignment.response.status, 201);
    const fileScopeOptions = await apiRequest(baseUrl, "/files/scope-options?limit=100", { accessToken: recipientToken });
    assert.equal(fileScopeOptions.response.status, 200);
    const branchFileScope = fileScopeOptions.body.items.find((item) => item.resourceType === "BRANCH_ATTACHMENT" && item.resourceId === otherBranchId);
    assert.ok(branchFileScope?.canRead && branchFileScope?.canUpload && branchFileScope?.canDelete);
    const companyFileScope = fileScopeOptions.body.items.find((item) => item.resourceType === "COMPANY_ATTACHMENT" && item.resourceId === companyId);
    assert.ok(companyFileScope?.canRead);
    assert.equal(companyFileScope?.canUpload, false, "Un permiso de sucursal no habilita cambios de archivos en la empresa.");
    assert.ok(!fileScopeOptions.body.items.some((item) => item.resourceId === deniedBranchId), "Las opciones no revelan sucursales sin permiso del recurso.");
    const fileWriteAtCompanyDenied = await multipartFileRequest(baseUrl, `/files?resourceType=COMPANY_ATTACHMENT&resourceId=${companyId}`, {
      accessToken: recipientToken, filename: "empresa-denegada.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(fileWriteAtCompanyDenied.response.status, 403, "files.upload no amplía branches.update a companies.update.");
    const fileListAtDeniedBranch = await apiRequest(baseUrl, `/files?resourceType=BRANCH_ATTACHMENT&resourceId=${deniedBranchId}`, { accessToken: recipientToken });
    assert.equal(fileListAtDeniedBranch.response.status, 403, "Un permiso de sucursal no autoriza otra sucursal.");
    const uploadedScopedBranchFile = await multipartFileRequest(baseUrl, `/files?resourceType=BRANCH_ATTACHMENT&resourceId=${otherBranchId}`, {
      accessToken: recipientToken, filename: "alcance-sucursal.pdf", mime: "application/pdf", content: pdfContent,
    });
    assert.equal(uploadedScopedBranchFile.response.status, 201, "El rol de sucursal puede cargar solo en la sucursal autorizada.");
    const scopedBranchDownload = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${uploadedScopedBranchFile.body.item.id}/content`, {
      headers: { Authorization: `Bearer ${recipientToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(scopedBranchDownload.status, 200);
    const wrongBranchDownload = await fetch(`http://127.0.0.1:${address.port}/api/v1/files/${uploadedScopedBranchFile.body.item.id}/content`, {
      headers: { Authorization: `Bearer ${tenantBToken}`, Origin: "http://127.0.0.1:5173", connection: "close" },
    });
    assert.equal(wrongBranchDownload.status, 404);
    const branchAuditRole = await createRole(`Auditoría de sucursal ${marker}`, ["audit.read"]);
    const branchAuditAssignment = await assign({ membershipId: recipientMembershipId, roleId: branchAuditRole.id, scopeType: "BRANCH", companyId, branchId: otherBranchId });
    assert.equal(branchAuditAssignment.response.status, 201);
    const branchRoleAssignmentAudit = await apiRequest(baseUrl, `/audit?resourceType=RoleAssignment&action=ROLE_ASSIGNED&resourceId=${branchAuditAssignment.body.id}`, { accessToken: recipientToken });
    assert.equal(branchRoleAssignmentAudit.response.status, 200);
    assert.ok(branchRoleAssignmentAudit.body.items.some((event) => event.branchId === otherBranchId), "Los cambios de permisos incluyen su alcance de sucursal.");
    const { appendAuditEvent } = await import("../apps/api/dist/modules/audit/audit-service.js");
    const legacyBranchAssignmentAuditId = await appendAuditEvent(database, {
      organizationId, actor: { type: "USER", userId: adminId }, action: "AUDIT_LEGACY_BRANCH_ASSIGNMENT",
      resourceType: "RoleAssignment", resourceId: randomUUID(), requestId: `task011-legacy-branch-${marker}`,
      after: { scopeType: "BRANCH", companyId, branchId: otherBranchId },
    });
    const legacyBranchAssignmentDetail = await apiRequest(baseUrl, `/audit/${legacyBranchAssignmentAuditId}`, { accessToken: recipientToken });
    assert.equal(legacyBranchAssignmentDetail.response.status, 200, "Eventos históricos pueden filtrarse por sucursal usando el alcance guardado en el diff.");
    const sanitizedAuditId = await appendAuditEvent(database, {
      organizationId, companyId, branchId: otherBranchId, actor: { type: "USER", userId: recipientId },
      action: "AUDIT_SANITIZATION_CHECK", resourceType: "AuditTest", resourceId: marker, requestId: `task011-${marker}`,
      before: { status: "ACTIVE", password: "audit-private-password", apiKey: "audit-private-api-key", email: "audit-private@example.test", address: "audit-private-address", nit: "audit-private-nit", documentNumber: "audit-private-document" },
      after: { status: "INACTIVE", safeCount: 2 },
    });
    const branchAuditPage = await apiRequest(baseUrl, "/audit?resourceType=File&action=FILE_UPLOADED", { accessToken: recipientToken });
    assert.equal(branchAuditPage.response.status, 200);
    assert.ok(branchAuditPage.body.items.some((event) => event.resourceId === uploadedScopedBranchFile.body.item.id && event.branchId === otherBranchId), "El auditor de sucursal ve cargas del ámbito autorizado.");
    assert.ok(!branchAuditPage.body.items.some((event) => event.resourceId === uploadedBranchFile.body.item.id), "El auditor de sucursal no recibe el archivo de otra sucursal.");
    const branchAuditDetail = await apiRequest(baseUrl, `/audit/${sanitizedAuditId}`, { accessToken: recipientToken });
    assert.equal(branchAuditDetail.response.status, 200);
    const branchAuditJson = JSON.stringify(branchAuditDetail.body);
    assert.match(branchAuditJson, /safeCount/u);
    assert.doesNotMatch(branchAuditJson, /audit-private-password|audit-private-api-key|audit-private@example\.test|audit-private-address|audit-private-nit|audit-private-document/u, "La consulta vuelve a filtrar secretos y datos sensibles del diff.");
    assert.equal(branchAuditPage.response.headers.get("cache-control"), "no-store, private", "El historial no debe almacenarse en caché.");
    const legacyAuditId = randomUUID();
    await database.query(
      `INSERT INTO audit_events (id, organization_id, company_id, branch_id, actor_id, actor_type, action, resource_type, resource_id, diff, request_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'USER'::"AuditActorType", 'AUDIT_LEGACY_SANITIZATION_CHECK', 'AuditTest', $6, $7::jsonb, $8)`,
      [legacyAuditId, organizationId, companyId, otherBranchId, recipientId, marker,
        JSON.stringify({ after: { safeLabel: "visible", password: "legacy-private-password", email: "legacy-private@example.test", nested: { accessToken: "legacy-private-token" }, filePath: "legacy-private-path" } }),
        `task011-legacy-${marker}`],
    );
    const legacyAuditDetail = await apiRequest(baseUrl, `/audit/${legacyAuditId}`, { accessToken: recipientToken });
    assert.equal(legacyAuditDetail.response.status, 200);
    const legacyAuditJson = JSON.stringify(legacyAuditDetail.body);
    assert.match(legacyAuditJson, /safeLabel/u);
    assert.doesNotMatch(legacyAuditJson, /legacy-private-password|legacy-private@example\.test|legacy-private-token|legacy-private-path/u, "La lectura filtra también valores sensibles de eventos históricos.");
    const actorAuditFilter = await apiRequest(baseUrl, `/audit?actorId=${recipientId}&action=AUDIT_SANITIZATION_CHECK`, { accessToken: recipientToken });
    assert.equal(actorAuditFilter.response.status, 200);
    assert.equal(actorAuditFilter.body.total, 1, "Los filtros de actor y acción aplican al total antes de paginar.");
    const futureAuditFilter = await apiRequest(baseUrl, `/audit?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, { accessToken: recipientToken });
    assert.equal(futureAuditFilter.response.status, 200);
    assert.equal(futureAuditFilter.body.total, 0);
    const invalidAuditDate = await apiRequest(baseUrl, "/audit?from=2026-02-31T00%3A00%3A00Z", { accessToken: recipientToken });
    assert.equal(invalidAuditDate.response.status, 400);
    const invalidAuditPageSize = await apiRequest(baseUrl, "/audit?limit=101", { accessToken: recipientToken });
    assert.equal(invalidAuditPageSize.response.status, 400, "La paginación tiene límites de servidor.");
    const foreignBranchAudit = await database.query("SELECT id FROM audit_events WHERE resource_id = $1 AND action = 'FILE_UPLOADED' LIMIT 1", [uploadedBranchFile.body.item.id]);
    assert.ok(foreignBranchAudit.rows[0]);
    const deniedBranchAuditDetail = await apiRequest(baseUrl, `/audit/${foreignBranchAudit.rows[0].id}`, { accessToken: recipientToken });
    assert.equal(deniedBranchAuditDetail.response.status, 404, "El detalle de otra sucursal se oculta para no enumerar eventos.");
    const companyAuditRole = await createRole(`Auditoría de empresa ${marker}`, ["audit.read"]);
    const companyAuditAssignment = await assign({ membershipId: recipientMembershipId, roleId: companyAuditRole.id, scopeType: "COMPANY", companyId });
    assert.equal(companyAuditAssignment.response.status, 201);
    const legacyCompanyAuditId = await appendAuditEvent(database, {
      organizationId, actor: { type: "USER", userId: adminId }, action: "AUDIT_LEGACY_COMPANY_SCOPE",
      resourceType: "Company", resourceId: companyId, requestId: `task011-legacy-company-${marker}`,
    });
    const legacyCompanyAuditDetail = await apiRequest(baseUrl, `/audit/${legacyCompanyAuditId}`, { accessToken: recipientToken });
    assert.equal(legacyCompanyAuditDetail.response.status, 200, "Eventos históricos de creación de empresa se filtran por el ID de recurso para un auditor de empresa.");
    const removeCompanyAuditAssignment = await apiRequest(baseUrl, `/organizations/role-assignments/${companyAuditAssignment.body.id}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(removeCompanyAuditAssignment.response.status, 204);
    const tenantAuditEventId = await appendAuditEvent(database, {
      organizationId: tenantBId, actor: { type: "USER", userId: tenantBAdminId }, action: "TENANT_B_AUDIT_FIXTURE",
      resourceType: "AuditTest", resourceId: marker, requestId: `task011-tenant-b-${marker}`,
    });
    const foreignTenantAuditDetail = await apiRequest(baseUrl, `/audit/${tenantAuditEventId}`, { accessToken: adminToken });
    assert.equal(foreignTenantAuditDetail.response.status, 404, "Un evento de otro tenant no se puede consultar por ID.");
    const auditMutationRejected = await apiRequest(baseUrl, `/audit/${sanitizedAuditId}`, { method: "PATCH", accessToken: adminToken, body: { action: "tampered" } });
    assert.equal(auditMutationRejected.response.status, 404, "La API de auditoría no expone operaciones de edición.");

    const removeOrganizationCatalogRead = await apiRequest(baseUrl, `/organizations/roles/${organizationReader.id}`, {
      method: "PATCH", accessToken: adminToken, body: { status: "INACTIVE" },
    });
    assert.equal(removeOrganizationCatalogRead.response.status, 200);
    const companyScopedCatalogs = await apiRequest(baseUrl, "/catalogs?limit=100", { accessToken: recipientToken });
    assert.equal(companyScopedCatalogs.response.status, 200);
    assert.ok(companyScopedCatalogs.body.items.some((item) => item.id === documentCatalog.id), "El permiso de alcance empresa puede consultar catálogos globales protegidos.");
    assert.ok(companyScopedCatalogs.body.items.some((item) => item.id === companyCatalog.body.id));
    assert.ok(!companyScopedCatalogs.body.items.some((item) => item.id === otherCompanyCatalog.body.id), "El alcance empresa no permite listar catálogos de otra empresa.");
    assert.ok(!companyScopedCatalogs.body.items.some((item) => item.id === organizationCatalog.body.id), "El alcance empresa no se amplía a catálogos de organización.");
    const companyCatalogItems = await apiRequest(baseUrl, `/catalogs/${companyCatalog.body.id}/items`, { accessToken: recipientToken });
    assert.equal(companyCatalogItems.response.status, 200);
    const otherCompanyCatalogItems = await apiRequest(baseUrl, `/catalogs/${otherCompanyCatalog.body.id}/items`, { accessToken: recipientToken });
    assert.equal(otherCompanyCatalogItems.response.status, 404, "Un alcance empresa no puede leer catálogos de otra empresa.");
    const organizationCatalogItems = await apiRequest(baseUrl, `/catalogs/${organizationCatalog.body.id}/items`, { accessToken: recipientToken });
    assert.equal(organizationCatalogItems.response.status, 404, "Un alcance empresa no puede consultar catálogos de organización.");
    const readerScopeOptions = await apiRequest(baseUrl, "/catalogs/scope-options", { accessToken: recipientToken });
    assert.equal(readerScopeOptions.response.status, 403, "Consultar catálogos no concede permiso para administrarlos.");

    const branchManagerAssignment = await apiRequest(baseUrl, "/organizations/role-assignments", {
      method: "POST", accessToken: recipientToken,
      body: { membershipId: adminMembershipId, roleId: branchReader.id, scopeType: "BRANCH", companyId, branchId },
    });
    assert.equal(branchManagerAssignment.response.status, 201, "El permiso roles.assign de sucursal permite operar en esa sucursal.");
    const duplicateAssignment = await apiRequest(baseUrl, "/organizations/role-assignments", {
      method: "POST", accessToken: recipientToken,
      body: { membershipId: adminMembershipId, roleId: branchReader.id, scopeType: "BRANCH", companyId, branchId },
    });
    assert.equal(duplicateAssignment.response.status, 409, "No deben duplicarse asignaciones del mismo rol y alcance.");
    const deniedOtherBranch = await apiRequest(baseUrl, "/organizations/role-assignments", {
      method: "POST", accessToken: recipientToken,
      body: { membershipId: adminMembershipId, roleId: branchReader.id, scopeType: "BRANCH", companyId, branchId: otherBranchId },
    });
    assert.equal(deniedOtherBranch.response.status, 403, "Un permiso de asignación de sucursal no autoriza otra sucursal de la empresa.");
    const deniedOtherCompany = await apiRequest(baseUrl, "/organizations/role-assignments", {
      method: "POST", accessToken: recipientToken,
      body: { membershipId: adminMembershipId, roleId: companyReader.id, scopeType: "COMPANY", companyId: otherCompanyId },
    });
    assert.equal(deniedOtherCompany.response.status, 403, "Un permiso de asignación de sucursal no autoriza otra empresa.");
    const deniedEscalation = await apiRequest(baseUrl, "/organizations/role-assignments", {
      method: "POST", accessToken: recipientToken,
      body: { membershipId: adminMembershipId, roleId: usersReader.id, scopeType: "BRANCH", companyId, branchId },
    });
    assert.equal(deniedEscalation.response.status, 403, "El actor no puede conceder un permiso que no posee.");
    const deniedRoleEdit = await apiRequest(baseUrl, `/organizations/roles/${companyReader.id}`, {
      method: "PATCH", accessToken: recipientToken, body: { name: "Escalada" },
    });
    assert.equal(deniedRoleEdit.response.status, 403, "Un asignador no puede editar el catálogo global del tenant.");
    const deniedRoleCreate = await apiRequest(baseUrl, "/organizations/roles", {
      method: "POST", accessToken: recipientToken, body: { name: "Escalada", permissionCodes: ["companies.read"] },
    });
    assert.equal(deniedRoleCreate.response.status, 403, "Un asignador no puede crear roles.");

    const inactiveRole = await apiRequest(baseUrl, `/organizations/roles/${companyReader.id}`, {
      method: "PATCH", accessToken: adminToken, body: { status: "INACTIVE" },
    });
    assert.equal(inactiveRole.response.status, 200);
    const afterRoleChange = await apiRequest(baseUrl, "/auth/me", { accessToken: recipientToken });
    assert.equal(afterRoleChange.response.status, 200);
    assert.ok(!afterRoleChange.body.permissions.includes("companies.read"), "El cambio de rol debe surtir efecto en la siguiente solicitud.");
    const assignmentList = await apiRequest(baseUrl, "/organizations/role-assignments?limit=100&offset=0", { accessToken: adminToken });
    assert.equal(assignmentList.response.status, 200);
    assert.ok(assignmentList.body.items.some((item) => item.scopeType === "BRANCH" && item.branchName));

    const unassigned = await apiRequest(baseUrl, `/organizations/role-assignments/${managerAssignment.body.id}`, {
      method: "DELETE", accessToken: adminToken,
    });
    assert.equal(unassigned.response.status, 204);
    const afterUnassign = await apiRequest(baseUrl, "/auth/me", { accessToken: recipientToken });
    assert.ok(!afterUnassign.body.permissions.includes("roles.assign"), "Retirar una asignación debe revocar permisos de inmediato.");

    const removeOnlyAdministrator = await apiRequest(baseUrl, `/organizations/role-assignments/${adminAssignmentId}`, {
      method: "DELETE", accessToken: adminToken,
    });
    assert.equal(removeOnlyAdministrator.response.status, 409, "No se puede retirar la última asignación administradora.");
    const adminRoleUpdate = await apiRequest(baseUrl, `/organizations/roles/${adminRoleResult.rows[0].id}`, {
      method: "PATCH", accessToken: adminToken, body: { permissionCodes: ["companies.read"] },
    });
    assert.equal(adminRoleUpdate.response.status, 409, "No se puede modificar el rol de modo que se pierda el último administrador.");

    const suspendRecipient = await apiRequest(baseUrl, `/organizations/users/${recipientMembershipId}`, { method: "PATCH", accessToken: adminToken, body: { status: "SUSPENDED" } });
    assert.equal(suspendRecipient.response.status, 200, "El admin debe suspender solo la membresía del tenant actual.");
    const suspendedAccess = await apiRequest(baseUrl, "/auth/me", { accessToken: recipientToken });
    assert.equal(suspendedAccess.response.status, 401, "Una membresía suspendida pierde acceso inmediatamente.");
    const accountAfterSuspend = await database.query("SELECT status FROM users WHERE id = $1::uuid", [recipientId]);
    assert.equal(accountAfterSuspend.rows[0].status, "ACTIVE", "Suspender la membresía no debe cambiar el estado global de la cuenta.");
    const recipientRestore = await apiRequest(baseUrl, `/organizations/users/${recipientMembershipId}`, { method: "PATCH", accessToken: adminToken, body: { status: "ACTIVE" } });
    assert.equal(recipientRestore.response.status, 200);
    const restoredAccess = await apiRequest(baseUrl, "/auth/me", { accessToken: recipientToken });
    assert.equal(restoredAccess.response.status, 200, "Reactivar la membresía restablece el acceso sin cambiar la cuenta global.");
    const recipientCannotSuspend = await apiRequest(baseUrl, `/organizations/users/${adminMembershipId}`, { method: "PATCH", accessToken: recipientToken, body: { status: "SUSPENDED" } });
    assert.equal(recipientCannotSuspend.response.status, 403, "Un usuario sin users.deactivate no puede suspender membresías.");
    const lastAdminSuspend = await apiRequest(baseUrl, `/organizations/users/${adminMembershipId}`, { method: "PATCH", accessToken: adminToken, body: { status: "SUSPENDED" } });
    assert.equal(lastAdminSuspend.response.status, 409, "No se puede suspender a la última membresía administradora.");
    const auditActions = await database.query(
      `SELECT count(*)::int AS total FROM audit_events
       WHERE organization_id = $1::uuid AND action IN ('ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_ASSIGNED', 'ROLE_UNASSIGNED',
         'COMPANY_CREATED', 'COMPANY_UPDATED', 'COMPANY_ACTIVATED', 'COMPANY_DEACTIVATED',
         'BRANCH_CREATED', 'BRANCH_UPDATED', 'BRANCH_ACTIVATED', 'BRANCH_DEACTIVATED',
         'USER_MEMBERSHIP_SUSPENDED', 'USER_MEMBERSHIP_REACTIVATED',
         'CATALOG_CREATED', 'CATALOG_UPDATED', 'CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED',
         'CATALOG_ITEM_CREATED', 'CATALOG_ITEM_UPDATED', 'CATALOG_ITEM_ACTIVATED', 'CATALOG_ITEM_DEACTIVATED',
         'SETTING_UPDATED', 'SETTING_OVERRIDE_REMOVED', 'BUSINESS_HOURS_REPLACED',
         'NUMBER_SEQUENCE_CREATED', 'NUMBER_SEQUENCE_UPDATED', 'NUMBER_SEQUENCE_ISSUED')`,
      [organizationId],
    );
    assert.ok(auditActions.rows[0].total >= 25, "Las mutaciones de roles, configuración, horarios y numeraciones deben quedar auditadas.");
    const sequenceAudit = await database.query(
      "SELECT count(*)::int AS total FROM audit_events WHERE organization_id = $1::uuid AND action = 'NUMBER_SEQUENCE_ISSUED'",
      [organizationId],
    );
    assert.equal(sequenceAudit.rows[0].total, 12, "Cada número emitido debe quedar auditado en su transacción.");
    const { cleanupOrphanedFiles } = await import("../apps/api/dist/modules/files/files-cleanup.js");
    const { getStoredFilePath } = await import("../apps/api/dist/modules/files/file-storage.js");
    const companyFileRow = await database.query("SELECT storage_key, status FROM files WHERE id = $1::uuid", [companyFileId]);
    assert.equal(companyFileRow.rows[0]?.status, "ACTIVE");
    const companyFilePath = getStoredFilePath(fileStorageRoot, companyFileRow.rows[0].storage_key);
    const branchFileRow = await database.query("SELECT storage_key, status FROM files WHERE id = $1::uuid", [uploadedBranchFile.body.item.id]);
    const branchFilePath = getStoredFilePath(fileStorageRoot, branchFileRow.rows[0].storage_key);
    const deleteCompanyFile = await apiRequest(baseUrl, `/files/${companyFileId}`, { method: "DELETE", accessToken: adminToken });
    assert.equal(deleteCompanyFile.response.status, 204);
    const pendingCompanyFile = await database.query("SELECT status, delete_requested_at FROM files WHERE id = $1::uuid", [companyFileId]);
    assert.equal(pendingCompanyFile.rows[0]?.status, "DELETE_PENDING");
    assert.equal(existsSync(companyFilePath), true, "El periodo de gracia conserva temporalmente el archivo privado.");
    const deletedFileHidden = await apiRequest(baseUrl, `/files/${companyFileId}`, { accessToken: adminToken });
    assert.equal(deletedFileHidden.response.status, 404, "El archivo deja de estar disponible al quitar su enlace.");
    await database.query("UPDATE files SET delete_requested_at = CURRENT_TIMESTAMP - INTERVAL '25 hours' WHERE id = $1::uuid", [companyFileId]);
    const orphanKey = randomUUID();
    const orphanPath = getStoredFilePath(fileStorageRoot, orphanKey);
    await mkdir(dirname(orphanPath), { recursive: true });
    await writeFile(orphanPath, Buffer.from("orphan"));
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(orphanPath, expired, expired);
    const temporaryPath = join(fileStorageRoot, ".tmp", `${randomUUID()}.tmp`);
    await writeFile(temporaryPath, Buffer.from("temporary"));
    await utimes(temporaryPath, expired, expired);
    const cleanup = await cleanupOrphanedFiles(database, fileStorageRoot, { gracePeriodMs: 24 * 60 * 60 * 1_000 });
    assert.deepEqual(cleanup, { removedRecords: 1, removedUntrackedFiles: 1, removedTemporaryFiles: 1 });
    assert.equal(existsSync(companyFilePath), false, "La limpieza purga el contenido sin enlace después del periodo de gracia.");
    assert.equal(existsSync(orphanPath), false, "La limpieza elimina un archivo físico sin metadatos tras el periodo de gracia.");
    assert.equal(existsSync(temporaryPath), false, "La limpieza elimina temporales vencidos.");
    assert.equal(existsSync(branchFilePath), true, "La limpieza no elimina archivos vinculados.");
    const linkedFilesAfterCleanup = await database.query("SELECT count(*)::int AS total FROM file_links WHERE file_id = $1::uuid", [uploadedBranchFile.body.item.id]);
    assert.equal(linkedFilesAfterCleanup.rows[0].total, 1);
    const purgeAudit = await database.query("SELECT count(*)::int AS total FROM audit_events WHERE organization_id = $1::uuid AND action = 'FILE_PURGED'", [organizationId]);
    assert.equal(purgeAudit.rows[0].total, 1, "La purga de metadatos queda auditada sin incluir nombre ni contenido.");
    const fileAudit = await database.query("SELECT count(*)::int AS total FROM audit_events WHERE organization_id = $1::uuid AND action IN ('FILE_UPLOADED', 'FILE_DELETE_REQUESTED')", [organizationId]);
    assert.ok(fileAudit.rows[0].total >= 3, "Las cargas y solicitudes de borrado quedan auditadas.");
    process.stdout.write("TASK-005/006/007/008/009 integration: aislamiento, metadatos privados, autorización del recurso, MIME/tamaño/traversal, streaming y purga segura correctos.\n");
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

async function verifyAuthentication(database, smtpPort, mailpitHttpPort, createApp) {
  await database.query("DELETE FROM auth_rate_limits");
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
    const platformSettings = await apiRequest(baseUrl, "/settings/installation", { accessToken: platformLogin.body.accessToken });
    assert.equal(platformSettings.response.status, 200);
    assert.deepEqual(platformSettings.body.items.map((item) => item.key).sort(), ["currency", "locale", "timeZone"]);
    assert.ok(!JSON.stringify(platformSettings.body).toLowerCase().includes("smtp"), "La configuración de instalación no serializa secretos SMTP.");
    const installationSettingSaved = await apiRequest(baseUrl, "/settings/installation", {
      method: "PUT", accessToken: platformLogin.body.accessToken, body: { key: "locale", value: "es" },
    });
    assert.equal(installationSettingSaved.response.status, 200, "Solo el administrador de plataforma puede modificar defaults de instalación.");
    const installationSecretRejected = await apiRequest(baseUrl, "/settings/installation", {
      method: "PUT", accessToken: platformLogin.body.accessToken, body: { key: "smtp.password", value: "not-a-secret" },
    });
    assert.equal(installationSecretRejected.response.status, 400, "La allowlist impide guardar credenciales SMTP en settings.");
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
    const platformOrganizationPage = await apiRequest(baseUrl, `/platform/organizations?search=${encodeURIComponent(createdOrganization.body.name)}`, { accessToken: platformLogin.body.accessToken });
    assert.equal(platformOrganizationPage.response.status, 200);
    assert.ok(platformOrganizationPage.body.items.some((item) => item.id === createdOrganization.body.id));
    const renamedPlatformOrganization = await apiRequest(baseUrl, `/platform/organizations/${createdOrganization.body.id}`, {
      method: "PATCH", accessToken: platformLogin.body.accessToken, body: { name: `${createdOrganization.body.name} renombrado` },
    });
    assert.equal(renamedPlatformOrganization.response.status, 200);
    assert.equal(renamedPlatformOrganization.body.name, `${createdOrganization.body.name} renombrado`);
    const suspendedPlatformOrganization = await apiRequest(baseUrl, `/platform/organizations/${createdOrganization.body.id}`, {
      method: "PATCH", accessToken: platformLogin.body.accessToken, body: { status: "SUSPENDED" },
    });
    assert.equal(suspendedPlatformOrganization.response.status, 200);
    assert.equal(suspendedPlatformOrganization.body.status, "SUSPENDED");
    const restoredPlatformOrganization = await apiRequest(baseUrl, `/platform/organizations/${createdOrganization.body.id}`, {
      method: "PATCH", accessToken: platformLogin.body.accessToken, body: { name: createdOrganization.body.name, status: "ACTIVE" },
    });
    assert.equal(restoredPlatformOrganization.response.status, 200);
    assert.equal(restoredPlatformOrganization.body.status, "ACTIVE");
    const platformOrganizationAudit = await database.query(
      `SELECT count(*)::int AS total FROM audit_events
       WHERE actor_id = $1::uuid AND resource_id = $2 AND action IN ('ORGANIZATION_UPDATED', 'ORGANIZATION_ACTIVATED', 'ORGANIZATION_DEACTIVATED')`,
      [platformLogin.body.user.id, createdOrganization.body.id],
    );
    assert.ok(platformOrganizationAudit.rows[0].total >= 3, "Actualizar, suspender y reactivar un tenant debe quedar auditado.");
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
const fileStorageRoot = await mkdtemp(join(tmpdir(), "mvp-transporte-files-"));
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
  await verifyRoleManagement(databasePool, createApp, fileStorageRoot);
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
  await rm(fileStorageRoot, { recursive: true, force: true });
  if (composeMayExist) {
    runDockerCompose(["down", "--remove-orphans"], hostPorts);
  }
}
