import type { PrismaClient } from "../../prisma/generated/client.ts";
import type { OperationalProfileItem, PageResponse, RecordStatus } from "@mvp-transporte/shared-contracts";
import { ApiError } from "../../errors.ts";
import type { AuthorizedTarget, BaseIntegrationClient, EmployeeDetails } from "../integrations/base-client.ts";

export type ProfileKind = "driver" | "assistant";

export async function assertActiveOperationalEmployee(
  database: Pick<PrismaClient, "driverProfile" | "assistantProfile">,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  kind: ProfileKind,
  employeeId: string,
): Promise<EmployeeDetails> {
  const profile = kind === "driver"
    ? await database.driverProfile.findFirst({ where: { organizationId: target.organizationId, companyId: target.companyId, employeeId, status: "ACTIVE" }, select: { id: true } })
    : await database.assistantProfile.findFirst({ where: { organizationId: target.organizationId, companyId: target.companyId, employeeId, status: "ACTIVE" }, select: { id: true } });
  if (!profile) throw new ApiError(409, kind === "driver" ? "DRIVER_PROFILE_REQUIRED" : "ASSISTANT_PROFILE_REQUIRED", `El ${kind === "driver" ? "conductor" : "ayudante"} debe tener un perfil activo en Transporte.`);
  const employee = await base.getEmployee(bearer, employeeId);
  if (employee.status !== "ACTIVE") throw new ApiError(409, "EMPLOYEE_INACTIVE", "La tripulación debe pertenecer a personal activo.");
  if (employee.companyId !== target.companyId) throw new ApiError(409, "EMPLOYEE_COMPANY_MISMATCH", "La tripulación debe pertenecer a la empresa del viaje.");
  return employee;
}

function employeeLabel(employee: EmployeeDetails): string {
  return `${employee.firstNames} ${employee.lastNames}`.trim();
}

function mapProfile(row: {
  id: string; organizationId: string; companyId: string; employeeId: string; status: RecordStatus; createdAt: Date; updatedAt: Date;
}, employee: EmployeeDetails | undefined): OperationalProfileItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyId: row.companyId,
    employeeId: row.employeeId,
    employeeCode: employee?.internalCode ?? "",
    employeeName: employee ? employeeLabel(employee) : "Empleado no disponible",
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProfiles(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  kind: ProfileKind,
  target: AuthorizedTarget,
  input: { limit: number; offset: number; status?: RecordStatus },
): Promise<PageResponse<OperationalProfileItem>> {
  const where = {
    organizationId: target.organizationId,
    companyId: target.companyId,
    ...(input.status ? { status: input.status } : {}),
  };
  const [rows, total] = kind === "driver"
    ? await Promise.all([
      database.driverProfile.findMany({ where, orderBy: [{ employeeId: "asc" }, { id: "asc" }], take: input.limit, skip: input.offset }),
      database.driverProfile.count({ where }),
    ])
    : await Promise.all([
      database.assistantProfile.findMany({ where, orderBy: [{ employeeId: "asc" }, { id: "asc" }], take: input.limit, skip: input.offset }),
      database.assistantProfile.count({ where }),
    ]);
  const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
  const byId = new Map<string, EmployeeDetails | undefined>();
  for (let offset = 0; offset < employeeIds.length; offset += 8) {
    const batch = employeeIds.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (employeeId) => {
      try {
        const employee = await base.getEmployee(bearer, employeeId);
        if (employee.companyId !== target.companyId) {
          throw new ApiError(409, "EMPLOYEE_COMPANY_MISMATCH", "El perfil está vinculado a un empleado de otra empresa.");
        }
        return [employeeId, employee] as const;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return [employeeId, undefined] as const;
        throw error;
      }
    }));
    for (const [employeeId, employee] of results) byId.set(employeeId, employee);
  }
  return { items: rows.map((row) => mapProfile(row, byId.get(row.employeeId))), total, limit: input.limit, offset: input.offset };
}

export async function createProfile(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  kind: ProfileKind,
  target: AuthorizedTarget,
  employeeId: string,
): Promise<OperationalProfileItem> {
  const employee = await base.getEmployee(bearer, employeeId);
  if (employee.status !== "ACTIVE") throw new ApiError(409, "EMPLOYEE_INACTIVE", "Solo se puede habilitar personal activo.");
  if (employee.companyId !== target.companyId) throw new ApiError(409, "EMPLOYEE_COMPANY_MISMATCH", "El empleado no pertenece a la empresa seleccionada.");
  return database.$transaction(async (transaction) => {
    const row = kind === "driver"
      ? await transaction.driverProfile.create({ data: {
        organizationId: target.organizationId,
        companyId: target.companyId,
        employeeId: employee.id,
      } })
      : await transaction.assistantProfile.create({ data: {
        organizationId: target.organizationId,
        companyId: target.companyId,
        employeeId: employee.id,
      } });
    await base.audit(bearer, target, {
      action: kind === "driver" ? "DRIVER_PROFILE_CREATED" : "ASSISTANT_PROFILE_CREATED",
      resourceType: kind === "driver" ? "transport.driver_profile" : "transport.assistant_profile",
      resourceId: row.id,
      after: { employeeId: row.employeeId, status: row.status },
    });
    return mapProfile(row, employee);
  });
}

export async function updateProfileStatus(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  kind: ProfileKind,
  target: AuthorizedTarget,
  id: string,
  status: RecordStatus,
): Promise<OperationalProfileItem> {
  if (status === "ACTIVE") {
    const current = kind === "driver"
      ? await database.driverProfile.findFirst({ where: { id, organizationId: target.organizationId, companyId: target.companyId } })
      : await database.assistantProfile.findFirst({ where: { id, organizationId: target.organizationId, companyId: target.companyId } });
    if (!current) throw new ApiError(404, "PROFILE_NOT_FOUND", "El perfil no está disponible.");
    const employee = await base.getEmployee(bearer, current.employeeId);
    if (employee.status !== "ACTIVE" || employee.companyId !== target.companyId) {
      throw new ApiError(409, "EMPLOYEE_UNAVAILABLE", "El empleado no está activo en esta empresa.");
    }
  }
  return database.$transaction(async (transaction) => {
    const current = kind === "driver"
      ? await transaction.driverProfile.findFirst({ where: { id, organizationId: target.organizationId, companyId: target.companyId } })
      : await transaction.assistantProfile.findFirst({ where: { id, organizationId: target.organizationId, companyId: target.companyId } });
    if (!current) throw new ApiError(404, "PROFILE_NOT_FOUND", "El perfil no está disponible.");
    const row = kind === "driver"
      ? await transaction.driverProfile.update({ where: { id }, data: { status } })
      : await transaction.assistantProfile.update({ where: { id }, data: { status } });
    await base.audit(bearer, target, {
      action: status === "INACTIVE"
        ? kind === "driver" ? "DRIVER_PROFILE_DEACTIVATED" : "ASSISTANT_PROFILE_DEACTIVATED"
        : kind === "driver" ? "DRIVER_PROFILE_REACTIVATED" : "ASSISTANT_PROFILE_REACTIVATED",
      resourceType: kind === "driver" ? "transport.driver_profile" : "transport.assistant_profile",
      resourceId: row.id,
      before: { employeeId: current.employeeId, status: current.status },
      after: { employeeId: row.employeeId, status: row.status },
    });
    const employee = await base.getEmployee(bearer, row.employeeId).catch(() => undefined);
    return mapProfile(row, employee);
  });
}
