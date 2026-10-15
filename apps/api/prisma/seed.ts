import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

const developmentEnvironments = new Set(["development", "test"]);
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const databaseUrl = process.env.DATABASE_URL;
if (!developmentEnvironments.has(process.env.NODE_ENV ?? "") || !databaseUrl) {
  throw new Error("El seed de fixtures requiere NODE_ENV=development o test y DATABASE_URL.");
}
if (process.env.NODE_ENV === "test" && process.env.MVP_TEST_DATABASE !== "true") {
  throw new Error("El seed de pruebas requiere la marca de base desechable.");
}
if (!localDatabaseHosts.has(new URL(databaseUrl).hostname)) {
  throw new Error("El seed de fixtures solo admite una base PostgreSQL local.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const permissions = [
  ["organizations.read", "Consultar organizaciones de plataforma"],
  ["organizations.create", "Crear organizaciones en plataforma"],
  ["organizations.update", "Actualizar organizaciones en plataforma"],
  ["organizations.activate", "Activar organizaciones en plataforma"],
  ["organizations.deactivate", "Desactivar organizaciones en plataforma"],
  ["companies.read", "Consultar empresas"],
  ["companies.create", "Crear empresas"],
  ["companies.update", "Actualizar empresas"],
  ["companies.deactivate", "Desactivar empresas"],
  ["branches.read", "Consultar sucursales"],
  ["branches.create", "Crear sucursales"],
  ["branches.update", "Actualizar sucursales"],
  ["branches.deactivate", "Desactivar sucursales"],
  ["users.read", "Consultar usuarios"],
  ["users.create", "Crear usuarios"],
  ["users.update", "Actualizar usuarios"],
  ["users.deactivate", "Desactivar usuarios"],
  ["roles.read", "Consultar roles"],
  ["roles.create", "Crear roles"],
  ["roles.update", "Actualizar roles"],
  ["roles.assign", "Asignar roles"],
  ["employees.read", "Consultar datos laborales"],
  ["employees.personal.read", "Consultar datos personales de empleados"],
  ["employees.create", "Crear empleados"],
  ["employees.update", "Actualizar empleados"],
  ["employees.deactivate", "Desactivar empleados"],
  ["employee_documents.read", "Consultar documentos de empleados"],
  ["employee_documents.manage", "Gestionar documentos de empleados"],
  ["settings.read", "Consultar configuración"],
  ["settings.update", "Actualizar configuración"],
  ["catalogs.read", "Consultar catálogos"],
  ["catalogs.manage", "Gestionar catálogos"],
  ["files.upload", "Cargar archivos privados"],
  ["files.read", "Consultar archivos autorizados"],
  ["files.download", "Descargar archivos autorizados"],
  ["files.delete", "Eliminar archivos autorizados"],
  ["audit.read", "Consultar auditoría"],
  ["notifications.read", "Consultar notificaciones"],
  ["notifications.manage", "Gestionar notificaciones"],
] as const;

const tenantPermissions: Record<string, readonly string[]> = {
  admin: permissions.filter(([code]) => !code.startsWith("organizations.")).map(([code]) => code),
  supervisor: [
    "companies.read",
    "branches.read",
    "employees.read",
    "employees.create",
    "employees.update",
    "catalogs.read",
    "files.upload",
    "files.read",
    "files.download",
    "notifications.read",
  ],
  operator: [
    "companies.read",
    "branches.read",
    "employees.read",
    "catalogs.read",
  ],
  viewer: ["companies.read", "branches.read", "catalogs.read"],
};

const tenants = [
  {
    organizationId: "00000000-0000-4000-8000-000000000001",
    companyId: "00000000-0000-4000-8000-000000000011",
    branchId: "00000000-0000-4000-8000-000000000021",
    userId: "00000000-0000-4000-8000-000000000031",
    membershipId: "00000000-0000-4000-8000-000000000041",
    assignmentId: "00000000-0000-4000-8000-000000000061",
    name: "Tenant de desarrollo A",
    companyName: "Empresa de desarrollo A",
    email: "demo.admin.a@example.test",
    assignedRoleCode: "admin",
    roles: [
      { id: "00000000-0000-4000-8000-000000000051", code: "admin", name: "Administrador" },
      { id: "00000000-0000-4000-8000-000000000053", code: "supervisor", name: "Supervisor" },
      { id: "00000000-0000-4000-8000-000000000054", code: "operator", name: "Operador" },
      { id: "00000000-0000-4000-8000-000000000055", code: "viewer", name: "Visor" },
    ],
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000002",
    companyId: "00000000-0000-4000-8000-000000000012",
    branchId: "00000000-0000-4000-8000-000000000022",
    userId: "00000000-0000-4000-8000-000000000032",
    membershipId: "00000000-0000-4000-8000-000000000042",
    assignmentId: "00000000-0000-4000-8000-000000000062",
    name: "Tenant de desarrollo B",
    companyName: "Empresa de desarrollo B",
    email: "demo.supervisor.b@example.test",
    assignedRoleCode: "supervisor",
    roles: [
      { id: "00000000-0000-4000-8000-000000000052", code: "admin", name: "Administrador" },
      { id: "00000000-0000-4000-8000-000000000056", code: "supervisor", name: "Supervisor" },
      { id: "00000000-0000-4000-8000-000000000057", code: "operator", name: "Operador" },
      { id: "00000000-0000-4000-8000-000000000058", code: "viewer", name: "Visor" },
    ],
  },
] as const;

async function seed(): Promise<void> {
  for (const [code, description] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description },
      update: { description },
    });
  }

  for (const tenant of tenants) {
    const assignedRoleName = tenant.roles.find((role) => role.code === tenant.assignedRoleCode)?.name;
    if (!assignedRoleName) {
      throw new Error("El rol de fixture no está definido.");
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.organization.upsert({
        where: { id: tenant.organizationId },
        create: { id: tenant.organizationId, name: tenant.name },
        update: { name: tenant.name, status: "ACTIVE" },
      });
      await transaction.company.upsert({
        where: { id: tenant.companyId },
        create: {
          id: tenant.companyId,
          organizationId: tenant.organizationId,
          legalName: tenant.companyName,
          nit: tenant.organizationId.endsWith("1") ? "DEV-A" : "DEV-B",
        },
        update: { legalName: tenant.companyName, status: "ACTIVE" },
      });
      await transaction.branch.upsert({
        where: { id: tenant.branchId },
        create: {
          id: tenant.branchId,
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          code: "CENTRAL",
          name: "Sucursal central",
        },
        update: { name: "Sucursal central", status: "ACTIVE" },
      });
      await transaction.user.upsert({
        where: { id: tenant.userId },
        create: {
          id: tenant.userId,
          normalizedEmail: tenant.email,
          displayName: assignedRoleName,
          status: "PENDING_ACTIVATION",
          passwordHash: null,
        },
        update: {
          normalizedEmail: tenant.email,
          displayName: assignedRoleName,
          status: "PENDING_ACTIVATION",
          passwordHash: null,
        },
      });
      await transaction.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
          },
        },
        create: {
          id: tenant.membershipId,
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          status: "ACTIVE",
        },
        update: { status: "ACTIVE" },
      });
      let assignedRoleId: string | undefined;
      for (const roleDefinition of tenant.roles) {
        await transaction.role.upsert({
          where: {
            organizationId_code: {
              organizationId: tenant.organizationId,
              code: roleDefinition.code,
            },
          },
          create: {
            id: roleDefinition.id,
            organizationId: tenant.organizationId,
            code: roleDefinition.code,
            name: roleDefinition.name,
          },
          update: { name: roleDefinition.name, status: "ACTIVE" },
        });

        const role = await transaction.role.findUniqueOrThrow({
          where: {
            organizationId_code: {
              organizationId: tenant.organizationId,
              code: roleDefinition.code,
            },
          },
          select: { id: true },
        });
        await transaction.rolePermission.deleteMany({ where: { roleId: role.id } });
        await transaction.rolePermission.createMany({
          data: tenantPermissions[roleDefinition.code].map((permissionCode) => ({
            organizationId: tenant.organizationId,
            roleId: role.id,
            permissionCode,
          })),
        });
        if (roleDefinition.code === tenant.assignedRoleCode) {
          assignedRoleId = role.id;
        }
      }

      if (!assignedRoleId) {
        throw new Error("El rol de fixture no está definido.");
      }
      await transaction.roleAssignment.upsert({
        where: { id: tenant.assignmentId },
        create: {
          id: tenant.assignmentId,
          organizationId: tenant.organizationId,
          membershipId: tenant.membershipId,
          roleId: assignedRoleId,
          scopeType: "ORGANIZATION",
        },
        update: {
          membershipId: tenant.membershipId,
          roleId: assignedRoleId,
          scopeType: "ORGANIZATION",
          companyId: null,
          branchId: null,
        },
      });
    });
  }
}

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
