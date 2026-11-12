import type { PrismaClient, Vehicle } from "../../prisma/generated/client.ts";
import type { PageResponse, VehicleItem } from "@mvp-transporte/shared-contracts";
import { ApiError } from "../../errors.ts";
import type { AuthorizedTarget, BaseIntegrationClient } from "../integrations/base-client.ts";

export interface VehicleCreateInput {
  plate: string;
  vehicleType: string;
  make: string;
  model: string;
  year: number | null;
  capacityKg: number;
  odometerKm: number | null;
}

export type VehicleUpdateInput = Partial<VehicleCreateInput> & { status?: "ACTIVE" | "INACTIVE" };

function mapVehicle(row: Vehicle, maintenanceBlocked = false): VehicleItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyId: row.companyId,
    branchId: row.branchId,
    plate: row.plate,
    vehicleType: row.vehicleType,
    make: row.make,
    model: row.model,
    year: row.year,
    capacityKg: row.capacityKg.toNumber(),
    odometerKm: row.odometerKm,
    maintenanceBlocked,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizePlate(plate: string): string {
  return plate.trim().toLocaleUpperCase("en-US").replace(/[\s-]+/gu, "");
}

function auditSnapshot(input: VehicleCreateInput | VehicleUpdateInput) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "companyId" && key !== "branchId"));
}

export async function listVehicles(
  database: PrismaClient,
  input: { target: AuthorizedTarget; limit: number; offset: number; search?: string; vehicleType?: string; status?: "ACTIVE" | "INACTIVE" },
): Promise<PageResponse<VehicleItem>> {
  const where = {
    organizationId: input.target.organizationId,
    companyId: input.target.companyId,
    ...(input.target.branchId ? { branchId: input.target.branchId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
    ...(input.search ? { OR: [
      { plate: { contains: input.search, mode: "insensitive" as const } },
      { make: { contains: input.search, mode: "insensitive" as const } },
      { model: { contains: input.search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    database.vehicle.findMany({ where, orderBy: [{ plateNormalized: "asc" }, { id: "asc" }], take: input.limit, skip: input.offset }),
    database.vehicle.count({ where }),
  ]);
  const blockedRows = items.length ? await database.maintenanceRecord.findMany({
    where: { vehicleId: { in: items.map((vehicle) => vehicle.id) }, status: "IN_PROGRESS", outOfService: true },
    select: { vehicleId: true },
  }) : [];
  const blockedIds = new Set(blockedRows.map((record) => record.vehicleId));
  return { items: items.map((vehicle) => mapVehicle(vehicle, blockedIds.has(vehicle.id))), total, limit: input.limit, offset: input.offset };
}

export async function getVehicle(database: PrismaClient, id: string): Promise<VehicleItem> {
  const row = await database.vehicle.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
  return mapVehicle(row, Boolean(await database.maintenanceRecord.findFirst({ where: { vehicleId: id, status: "IN_PROGRESS", outOfService: true }, select: { id: true } })));
}

export async function assertVehicleAssignable(database: PrismaClient, id: string): Promise<void> {
  if (await database.maintenanceRecord.findFirst({ where: { vehicleId: id, status: "IN_PROGRESS", outOfService: true }, select: { id: true } })) {
    throw new ApiError(409, "VEHICLE_UNDER_MAINTENANCE", "El vehículo está fuera de servicio por mantenimiento.");
  }
}

export async function createVehicle(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  input: VehicleCreateInput,
): Promise<VehicleItem> {
  return database.$transaction(async (transaction) => {
    const row = await transaction.vehicle.create({ data: {
      organizationId: target.organizationId,
      companyId: target.companyId,
      branchId: target.branchId,
      plate: input.plate.trim().toLocaleUpperCase("en-US").replace(/\s+/gu, " "),
      plateNormalized: normalizePlate(input.plate),
      vehicleType: input.vehicleType.trim().toLocaleUpperCase("en-US"),
      make: input.make.trim(),
      model: input.model.trim(),
      year: input.year,
      capacityKg: input.capacityKg,
      odometerKm: input.odometerKm,
    } });
    await base.audit(bearer, target, {
      action: "VEHICLE_CREATED",
      resourceType: "transport.vehicle",
      resourceId: row.id,
      after: auditSnapshot({ ...input, status: "ACTIVE" }),
    });
    const maintenanceBlocked = Boolean(await transaction.maintenanceRecord.findFirst({ where: { vehicleId: row.id, status: "IN_PROGRESS", outOfService: true }, select: { id: true } }));
    return mapVehicle(row, maintenanceBlocked);
  });
}

export async function updateVehicle(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  id: string,
  input: VehicleUpdateInput,
): Promise<VehicleItem> {
  return database.$transaction(async (transaction) => {
    const current = await transaction.vehicle.findFirst({ where: { id, organizationId: target.organizationId, companyId: target.companyId } });
    if (!current || current.branchId !== target.branchId) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    if (input.odometerKm !== undefined && input.odometerKm !== null && current.odometerKm !== null && input.odometerKm < current.odometerKm) {
      throw new ApiError(409, "ODOMETER_CANNOT_DECREASE", "El kilometraje no puede ser menor al último valor registrado.");
    }
    if (input.odometerKm === null && current.odometerKm !== null) {
      throw new ApiError(409, "ODOMETER_CANNOT_CLEAR", "No se puede borrar el kilometraje una vez registrado.");
    }
    const data = {
      ...(input.plate !== undefined ? { plate: input.plate.trim().toLocaleUpperCase("en-US").replace(/\s+/gu, " "), plateNormalized: normalizePlate(input.plate) } : {}),
      ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType.trim().toLocaleUpperCase("en-US") } : {}),
      ...(input.make !== undefined ? { make: input.make.trim() } : {}),
      ...(input.model !== undefined ? { model: input.model.trim() } : {}),
      ...(input.year !== undefined ? { year: input.year } : {}),
      ...(input.capacityKg !== undefined ? { capacityKg: input.capacityKg } : {}),
      ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    const row = await transaction.vehicle.update({ where: { id: current.id }, data });
    await base.audit(bearer, target, {
      action: input.status === "INACTIVE" ? "VEHICLE_DEACTIVATED" : "VEHICLE_UPDATED",
      resourceType: "transport.vehicle",
      resourceId: row.id,
      before: auditSnapshot({
        plate: current.plate,
        vehicleType: current.vehicleType,
        make: current.make,
        model: current.model,
        year: current.year,
        capacityKg: current.capacityKg.toNumber(),
        odometerKm: current.odometerKm,
        status: current.status,
      }),
      after: auditSnapshot({
        plate: row.plate,
        vehicleType: row.vehicleType,
        make: row.make,
        model: row.model,
        year: row.year,
        capacityKg: row.capacityKg.toNumber(),
        odometerKm: row.odometerKm,
        status: row.status,
      }),
    });
    const maintenanceBlocked = Boolean(await transaction.maintenanceRecord.findFirst({ where: { vehicleId: row.id, status: "IN_PROGRESS", outOfService: true }, select: { id: true } }));
    return mapVehicle(row, maintenanceBlocked);
  });
}
