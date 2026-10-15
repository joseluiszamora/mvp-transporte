import assert from "node:assert/strict";
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

function runDockerCompose(args, hostPort) {
  const result = spawnSync(
    dockerCommand,
    ["compose", "-f", composeFile, "-p", projectName, ...args],
    {
      cwd: repositoryRoot,
      env: getDockerEnvironment({ TEST_POSTGRES_HOST_PORT: String(hostPort) }),
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

const hostPort = await getAvailablePort();
let server;
let databasePool;
let composeMayExist = false;

try {
  composeMayExist = true;
  runDockerCompose(["up", "--detach", "--wait", "integration-db"], hostPort);

  const testDatabaseUrl = `postgresql://mvp_test:mvp_test_password@127.0.0.1:${hostPort}/mvp_integration`;
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
    runDockerCompose(["down", "--remove-orphans"], hostPort);
  }
}
