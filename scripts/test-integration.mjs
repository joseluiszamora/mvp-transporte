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
