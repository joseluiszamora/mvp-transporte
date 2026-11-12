import type {
  DocumentOwnerType,
  FuelRecordItem,
  FuelSummaryItem,
  MaintenancePlanItem,
  MaintenanceRecordItem,
  ResourceDocumentItem,
  VehicleFuelTankItem,
} from "@mvp-transporte/shared-contracts";
import type {
  FuelRecord,
  FuelType,
  FuelUnit,
  MaintenancePlan,
  MaintenanceRecord,
  MaintenanceRecordStatus,
  MaintenanceType,
  PrismaClient,
  ResourceDocument,
  VehicleFuelTank,
} from "../../prisma/generated/client.ts";
import type { Prisma } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { AuthorizedTarget, BaseIntegrationClient } from "../integrations/base-client.ts";

type DocumentWithRenewal = ResourceDocument & { renewedBy?: { id: string } | null };
type VehicleSnapshot = { id: string; organizationId: string; companyId: string; branchId: string | null; status: "ACTIVE" | "INACTIVE"; odometerKm: number | null };

function scopeWhere(target: AuthorizedTarget) {
  return {
    organizationId: target.organizationId,
    companyId: target.companyId,
    ...(target.branchId ? { branchId: target.branchId } : {}),
  };
}

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function assertTripResourcesAvailable(
  transaction: Prisma.TransactionClient,
  target: AuthorizedTarget,
  trip: { vehicleId: string; plannedStartAt: Date; plannedEndAt: Date },
  employeeIds: string[],
): Promise<void> {
  const blockedByMaintenance = await transaction.maintenanceRecord.findFirst({ where: {
    organizationId: target.organizationId,
    companyId: target.companyId,
    vehicleId: trip.vehicleId,
    OR: [
      { status: "IN_PROGRESS", outOfService: true },
      { status: "SCHEDULED", scheduledAt: { gte: dayStartUtc(trip.plannedStartAt), lte: dayStartUtc(trip.plannedEndAt) } },
    ],
  }, select: { id: true } });
  if (blockedByMaintenance) throw new ApiError(409, "TRIP_MAINTENANCE_CONFLICT", "El vehículo tiene mantenimiento activo o programado durante el viaje.");

  const expiredDocument = await transaction.resourceDocument.findFirst({ where: {
    organizationId: target.organizationId,
    companyId: target.companyId,
    status: "CURRENT",
    expiresAt: { lt: dayStartUtc(trip.plannedEndAt) },
    OR: [
      { ownerType: "VEHICLE", vehicleId: trip.vehicleId },
      ...(employeeIds.length > 0 ? [{ ownerType: "EMPLOYEE" as const, employeeId: { in: employeeIds } }] : []),
    ],
  }, select: { id: true } });
  if (expiredDocument) throw new ApiError(409, "TRIP_DOCUMENT_EXPIRED", "Un documento vigente del vehículo o la tripulación vence antes de terminar el viaje.");
}

function mapDocument(row: DocumentWithRenewal, remoteFile?: Awaited<ReturnType<BaseIntegrationClient["listExternalFiles"]>>[number]): ResourceDocumentItem {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerType === "VEHICLE" ? row.vehicleId as string : row.employeeId as string,
    companyId: row.companyId,
    branchId: row.branchId,
    documentType: row.documentType,
    fileId: row.fileId,
    originalName: remoteFile?.originalName ?? "Archivo no disponible",
    detectedMime: remoteFile?.detectedMime ?? "application/pdf",
    bytes: remoteFile?.bytes ?? 0,
    issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
    expiresAt: row.expiresAt?.toISOString().slice(0, 10) ?? null,
    status: row.status,
    supersedesId: row.supersedesId,
    renewedById: row.renewedBy?.id ?? null,
    createdAt: row.createdAt.toISOString(),
    canDownload: remoteFile?.canDownload ?? false,
  };
}

function documentOwnerWhere(ownerType: DocumentOwnerType, ownerId: string) {
  return ownerType === "VEHICLE" ? { ownerType, vehicleId: ownerId } : { ownerType, employeeId: ownerId };
}

export async function getDocument(database: PrismaClient, id: string, target?: AuthorizedTarget): Promise<DocumentWithRenewal> {
  const row = await database.resourceDocument.findUnique({ where: { id }, include: { renewedBy: { select: { id: true } } } });
  if (!row || (target && (row.organizationId !== target.organizationId || row.companyId !== target.companyId || row.branchId !== target.branchId))) {
    throw new ApiError(404, "DOCUMENT_NOT_FOUND", "El documento no está disponible.");
  }
  return row;
}

export async function assertRenewalTarget(
  database: PrismaClient,
  id: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
  target: AuthorizedTarget,
  documentType: string,
): Promise<void> {
  const row = await getDocument(database, id, target);
  if (row.status !== "CURRENT" || row.renewedBy || row.ownerType !== ownerType ||
    (ownerType === "VEHICLE" ? row.vehicleId !== ownerId : row.employeeId !== ownerId) ||
    row.documentType.trim().toLocaleLowerCase("es-BO") !== documentType.trim().toLocaleLowerCase("es-BO")) {
    throw new ApiError(409, "DOCUMENT_CANNOT_RENEW", "El documento ya fue renovado o no pertenece al recurso seleccionado.");
  }
}

export async function listDocuments(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
  target: AuthorizedTarget,
): Promise<ResourceDocumentItem[]> {
  const [rows, remoteFiles] = await Promise.all([
    database.resourceDocument.findMany({
      where: { ...scopeWhere(target), ...documentOwnerWhere(ownerType, ownerId) },
      include: { renewedBy: { select: { id: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    base.listExternalFiles(bearer, ownerType, ownerId, target),
  ]);
  const byId = new Map(remoteFiles.map((file) => [file.id, file]));
  return rows.map((row) => mapDocument(row, byId.get(row.fileId)));
}

export async function createDocument(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
  target: AuthorizedTarget,
  input: { documentType: string; issuedAt: Date | null; expiresAt: Date | null; supersedesId: string | null; fileId: string },
): Promise<ResourceDocumentItem> {
  return database.$transaction(async (transaction) => {
    if (input.supersedesId) {
      const previous = await transaction.resourceDocument.findFirst({
        where: { id: input.supersedesId, ...scopeWhere(target), ...documentOwnerWhere(ownerType, ownerId), status: "CURRENT", renewedBy: null },
        include: { renewedBy: { select: { id: true } } },
      });
      if (!previous || previous.documentType.trim().toLocaleLowerCase("es-BO") !== input.documentType.trim().toLocaleLowerCase("es-BO")) {
        throw new ApiError(409, "DOCUMENT_CANNOT_RENEW", "El documento anterior no está disponible para renovar este tipo de documento.");
      }
      const row = await transaction.resourceDocument.create({ data: {
        ...scopeWhere(target), ownerType, vehicleId: ownerType === "VEHICLE" ? ownerId : null,
        employeeId: ownerType === "EMPLOYEE" ? ownerId : null, documentType: input.documentType,
        fileId: input.fileId, issuedAt: input.issuedAt, expiresAt: input.expiresAt, supersedesId: previous.id,
      }, include: { renewedBy: { select: { id: true } } } });
      await transaction.resourceDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
      await base.audit(bearer, target, {
        action: "DOCUMENT_RENEWED", resourceType: "transport.resource_document", resourceId: row.id,
        before: { documentId: previous.id, status: previous.status },
        after: { ownerType, ownerId, documentType: row.documentType, expiresAt: row.expiresAt?.toISOString() ?? null, fileId: row.fileId },
      });
      return mapDocument(row);
    }
    const row = await transaction.resourceDocument.create({ data: {
      ...scopeWhere(target), ownerType, vehicleId: ownerType === "VEHICLE" ? ownerId : null,
      employeeId: ownerType === "EMPLOYEE" ? ownerId : null, documentType: input.documentType,
      fileId: input.fileId, issuedAt: input.issuedAt, expiresAt: input.expiresAt,
    }, include: { renewedBy: { select: { id: true } } } });
    await base.audit(bearer, target, {
      action: "DOCUMENT_CREATED", resourceType: "transport.resource_document", resourceId: row.id,
      after: { ownerType, ownerId, documentType: row.documentType, issuedAt: row.issuedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, fileId: row.fileId },
    });
    return mapDocument(row);
  });
}

function mapMaintenancePlan(row: MaintenancePlan): MaintenancePlanItem {
  return {
    id: row.id, vehicleId: row.vehicleId, name: row.name, intervalKm: row.intervalKm, intervalDays: row.intervalDays,
    windowDays: row.windowDays, nextDueKm: row.nextDueKm,
    nextDueAt: row.nextDueAt?.toISOString().slice(0, 10) ?? null,
    windowStartAt: row.windowStartAt?.toISOString().slice(0, 10) ?? null,
    windowEndAt: row.windowEndAt?.toISOString().slice(0, 10) ?? null,
    status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMaintenanceRecord(row: MaintenanceRecord): MaintenanceRecordItem {
  return {
    id: row.id, vehicleId: row.vehicleId, planId: row.planId, type: row.type, status: row.status,
    description: row.description, provider: row.provider, scheduledAt: row.scheduledAt?.toISOString().slice(0, 10) ?? null,
    startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
    outOfService: row.outOfService, odometerKm: row.odometerKm, costAmount: row.costAmount?.toNumber() ?? null,
    currencyCode: row.currencyCode.trim(), createdAt: row.createdAt.toISOString(),
  };
}

function dateWindow(dueAt: Date, windowDays: number) {
  const start = new Date(dueAt);
  const end = new Date(dueAt);
  start.setUTCDate(start.getUTCDate() - windowDays);
  end.setUTCDate(end.getUTCDate() + windowDays);
  return { windowStartAt: start, windowEndAt: end };
}

export async function listMaintenancePlans(database: PrismaClient, target: AuthorizedTarget, vehicleId?: string) {
  const rows = await database.maintenancePlan.findMany({
    where: { ...scopeWhere(target), ...(vehicleId ? { vehicleId } : {}) },
    orderBy: [{ vehicleId: "asc" }, { name: "asc" }],
  });
  return rows.map(mapMaintenancePlan);
}

export async function createMaintenancePlan(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  vehicle: VehicleSnapshot,
  input: { name: string; intervalKm: number | null; intervalDays: number | null; windowDays: number },
): Promise<MaintenancePlanItem> {
  if (input.intervalKm !== null && vehicle.odometerKm === null) throw new ApiError(409, "ODOMETER_REQUIRED", "Registra el kilometraje del vehículo antes de crear un plan por km.");
  const nextDueKm = input.intervalKm === null ? null : (vehicle.odometerKm as number) + input.intervalKm;
  const nextDueAt = input.intervalDays === null ? null : new Date(Date.now() + input.intervalDays * 86_400_000);
  const window = nextDueAt ? dateWindow(nextDueAt, input.windowDays) : { windowStartAt: null, windowEndAt: null };
  return database.$transaction(async (transaction) => {
    const row = await transaction.maintenancePlan.create({ data: {
      organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      vehicleId: vehicle.id, name: input.name, intervalKm: input.intervalKm, intervalDays: input.intervalDays,
      windowDays: input.windowDays, nextDueKm, nextDueAt, ...window,
    } });
    await base.audit(bearer, target, {
      action: "MAINTENANCE_PLAN_CREATED", resourceType: "transport.maintenance_plan", resourceId: row.id,
      after: { vehicleId: row.vehicleId, name: row.name, intervalKm: row.intervalKm, intervalDays: row.intervalDays, nextDueKm, nextDueAt: nextDueAt?.toISOString() ?? null, ...window },
    });
    return mapMaintenancePlan(row);
  });
}

export async function updateMaintenancePlanStatus(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  id: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<MaintenancePlanItem> {
  return database.$transaction(async (transaction) => {
    const current = await transaction.maintenancePlan.findFirst({ where: { id, ...scopeWhere(target) } });
    if (!current) throw new ApiError(404, "MAINTENANCE_PLAN_NOT_FOUND", "El plan de mantenimiento no está disponible.");
    const row = await transaction.maintenancePlan.update({ where: { id }, data: { status } });
    await base.audit(bearer, target, {
      action: "MAINTENANCE_PLAN_STATUS_CHANGED", resourceType: "transport.maintenance_plan", resourceId: id,
      before: { status: current.status }, after: { status: row.status },
    });
    return mapMaintenancePlan(row);
  });
}

export async function listMaintenanceRecords(database: PrismaClient, target: AuthorizedTarget, vehicleId?: string) {
  const rows = await database.maintenanceRecord.findMany({
    where: { ...scopeWhere(target), ...(vehicleId ? { vehicleId } : {}) },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(mapMaintenanceRecord);
}

export async function createMaintenanceRecord(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  vehicle: VehicleSnapshot,
  input: {
    planId: string | null; type: MaintenanceType; description: string; provider: string | null;
    scheduledAt: Date | null; status: MaintenanceRecordStatus; outOfService: boolean;
    odometerKm: number | null; costAmount: number | null; currencyCode: string;
  },
): Promise<MaintenanceRecordItem> {
  if (input.odometerKm !== null && vehicle.odometerKm !== null && input.odometerKm < vehicle.odometerKm) {
    throw new ApiError(409, "ODOMETER_CANNOT_DECREASE", "El kilometraje no puede ser menor al último valor registrado.");
  }
  if (input.outOfService && input.status !== "IN_PROGRESS") throw new ApiError(400, "INVALID_REQUEST", "Marca fuera de servicio únicamente un mantenimiento en curso.");
  return database.$transaction(async (transaction) => {
    if (input.planId && !await transaction.maintenancePlan.findFirst({ where: { id: input.planId, vehicleId: vehicle.id, ...scopeWhere(target), status: "ACTIVE" } })) {
      throw new ApiError(400, "INVALID_MAINTENANCE_PLAN", "El plan no pertenece al vehículo o no está activo.");
    }
    const now = new Date();
    const row = await transaction.maintenanceRecord.create({ data: {
      organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      vehicleId: vehicle.id, planId: input.planId, type: input.type, status: input.status,
      description: input.description, provider: input.provider, scheduledAt: input.scheduledAt,
      startedAt: input.status === "IN_PROGRESS" ? now : null,
      completedAt: input.status === "COMPLETED" ? now : null,
      outOfService: input.outOfService, odometerKm: input.odometerKm,
      costAmount: input.costAmount, currencyCode: input.currencyCode,
    } });
    if (input.odometerKm !== null && (vehicle.odometerKm === null || input.odometerKm > vehicle.odometerKm)) {
      await transaction.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: input.odometerKm } });
    }
    const planSchedule = input.status === "COMPLETED" && input.planId
      ? await updatePlanAfterService(transaction, input.planId, row.completedAt ?? now, input.odometerKm ?? vehicle.odometerKm)
      : null;
    await base.audit(bearer, target, {
      action: "MAINTENANCE_RECORD_CREATED", resourceType: "transport.maintenance_record", resourceId: row.id,
      after: { vehicleId: row.vehicleId, planId: row.planId, type: row.type, status: row.status, outOfService: row.outOfService, odometerKm: row.odometerKm, costAmount: row.costAmount?.toNumber() ?? null, currencyCode: row.currencyCode, ...(planSchedule ? { nextPlanSchedule: planSchedule } : {}) },
    });
    return mapMaintenanceRecord(row);
  });
}

async function updatePlanAfterService(
  transaction: Prisma.TransactionClient,
  planId: string,
  completedAt: Date,
  completedKm: number | null,
): Promise<{ nextDueKm: number | null; nextDueAt: string | null; windowStartAt: string | null; windowEndAt: string | null } | null> {
  const plan = await transaction.maintenancePlan.findUnique({ where: { id: planId } });
  if (!plan) return null;
  if (plan.intervalKm !== null && completedKm === null) throw new ApiError(409, "ODOMETER_REQUIRED", "Registra el kilometraje al completar este plan preventivo.");
  const nextDueKm = plan.intervalKm === null ? null : (completedKm as number) + plan.intervalKm;
  const nextDueAt = plan.intervalDays === null ? null : new Date(completedAt.getTime() + plan.intervalDays * 86_400_000);
  const window = nextDueAt ? dateWindow(nextDueAt, plan.windowDays) : { windowStartAt: null, windowEndAt: null };
  await transaction.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueKm, nextDueAt, ...window } });
  return {
    nextDueKm,
    nextDueAt: nextDueAt?.toISOString().slice(0, 10) ?? null,
    windowStartAt: window.windowStartAt?.toISOString().slice(0, 10) ?? null,
    windowEndAt: window.windowEndAt?.toISOString().slice(0, 10) ?? null,
  };
}

export async function updateMaintenanceRecord(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  id: string,
  input: { status: MaintenanceRecordStatus; outOfService?: boolean; odometerKm?: number | null },
): Promise<MaintenanceRecordItem> {
  return database.$transaction(async (transaction) => {
    const current = await transaction.maintenanceRecord.findFirst({ where: { id, ...scopeWhere(target) } });
    if (!current) throw new ApiError(404, "MAINTENANCE_RECORD_NOT_FOUND", "El mantenimiento no está disponible.");
    const transitions: Record<MaintenanceRecordStatus, MaintenanceRecordStatus[]> = {
      SCHEDULED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
    };
    if (input.status !== current.status && !transitions[current.status].includes(input.status)) {
      throw new ApiError(409, "INVALID_MAINTENANCE_TRANSITION", "No se puede cambiar el mantenimiento desde su estado actual.");
    }
    if (input.outOfService && input.status !== "IN_PROGRESS") throw new ApiError(400, "INVALID_REQUEST", "Un mantenimiento solo bloquea el vehículo mientras está en curso.");
    const vehicle = await transaction.vehicle.findUnique({ where: { id: current.vehicleId } });
    if (!vehicle) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    const odometerKm = input.odometerKm === undefined ? current.odometerKm : input.odometerKm;
    if (odometerKm !== null && vehicle.odometerKm !== null && odometerKm < vehicle.odometerKm) throw new ApiError(409, "ODOMETER_CANNOT_DECREASE", "El kilometraje no puede ser menor al último valor registrado.");
    if (input.status === "COMPLETED" && current.planId && odometerKm === null) throw new ApiError(409, "ODOMETER_REQUIRED", "Registra el kilometraje al completar el mantenimiento preventivo.");
    const now = new Date();
    const row = await transaction.maintenanceRecord.update({ where: { id }, data: {
      status: input.status,
      outOfService: input.outOfService ?? (input.status === "IN_PROGRESS" ? current.outOfService : false),
      ...(odometerKm !== current.odometerKm ? { odometerKm } : {}),
      ...(input.status === "IN_PROGRESS" && current.startedAt === null ? { startedAt: now } : {}),
      ...(input.status === "COMPLETED" ? { completedAt: now } : {}),
    } });
    if (odometerKm !== null && (vehicle.odometerKm === null || odometerKm > vehicle.odometerKm)) {
      await transaction.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm } });
    }
    const planSchedule = input.status === "COMPLETED" && current.planId
      ? await updatePlanAfterService(transaction, current.planId, now, odometerKm)
      : null;
    await base.audit(bearer, target, {
      action: "MAINTENANCE_RECORD_STATUS_CHANGED", resourceType: "transport.maintenance_record", resourceId: id,
      before: { status: current.status, outOfService: current.outOfService, odometerKm: current.odometerKm },
      after: { status: row.status, outOfService: row.outOfService, odometerKm: row.odometerKm, ...(planSchedule ? { nextPlanSchedule: planSchedule } : {}) },
    });
    return mapMaintenanceRecord(row);
  });
}

function mapTank(row: VehicleFuelTank): VehicleFuelTankItem {
  return { id: row.id, vehicleId: row.vehicleId, name: row.name, fuelType: row.fuelType, unit: row.unit, capacity: row.capacity.toNumber(), status: row.status, createdAt: row.createdAt.toISOString() };
}

function mapFuelRecord(row: FuelRecord & { tank?: { name: string } }): FuelRecordItem {
  return {
    id: row.id, vehicleId: row.vehicleId, tankId: row.tankId, tankName: row.tank?.name ?? "Tanque",
    fuelType: row.fuelType, unit: row.unit, quantity: row.quantity.toNumber(), costAmount: row.costAmount.toNumber(),
    currencyCode: row.currencyCode.trim(), odometerKm: row.odometerKm, occurredAt: row.occurredAt.toISOString(), provider: row.provider,
  };
}

export async function listFuelTanks(database: PrismaClient, target: AuthorizedTarget, vehicleId?: string) {
  const rows = await database.vehicleFuelTank.findMany({ where: { ...scopeWhere(target), ...(vehicleId ? { vehicleId } : {}) }, orderBy: [{ vehicleId: "asc" }, { name: "asc" }] });
  return rows.map(mapTank);
}

export async function createFuelTank(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  vehicle: VehicleSnapshot,
  input: { name: string; fuelType: FuelType; unit: FuelUnit; capacity: number },
): Promise<VehicleFuelTankItem> {
  return database.$transaction(async (transaction) => {
    const row = await transaction.vehicleFuelTank.create({ data: {
      organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      vehicleId: vehicle.id, name: input.name, fuelType: input.fuelType, unit: input.unit, capacity: input.capacity,
    } });
    await base.audit(bearer, target, {
      action: "FUEL_TANK_CREATED", resourceType: "transport.vehicle_fuel_tank", resourceId: row.id,
      after: { vehicleId: row.vehicleId, name: row.name, fuelType: row.fuelType, unit: row.unit, capacity: row.capacity.toNumber() },
    });
    return mapTank(row);
  });
}

export async function updateFuelTankStatus(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  id: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<VehicleFuelTankItem> {
  return database.$transaction(async (transaction) => {
    const current = await transaction.vehicleFuelTank.findFirst({ where: { id, ...scopeWhere(target) } });
    if (!current) throw new ApiError(404, "FUEL_TANK_NOT_FOUND", "El tanque no está disponible.");
    const row = await transaction.vehicleFuelTank.update({ where: { id }, data: { status } });
    await base.audit(bearer, target, {
      action: "FUEL_TANK_STATUS_CHANGED", resourceType: "transport.vehicle_fuel_tank", resourceId: id,
      before: { status: current.status }, after: { status: row.status },
    });
    return mapTank(row);
  });
}

export async function listFuelRecords(database: PrismaClient, target: AuthorizedTarget, vehicleId?: string) {
  const rows = await database.fuelRecord.findMany({
    where: { ...scopeWhere(target), ...(vehicleId ? { vehicleId } : {}) },
    include: { tank: { select: { name: true } } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapFuelRecord);
}

export async function createFuelRecord(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  vehicle: VehicleSnapshot,
  input: { tankId: string; quantity: number; costAmount: number; currencyCode: string; odometerKm: number; occurredAt: Date; provider: string | null },
): Promise<FuelRecordItem> {
  if (vehicle.status !== "ACTIVE") throw new ApiError(409, "VEHICLE_INACTIVE", "No se puede registrar combustible para un vehículo inactivo.");
  if (vehicle.odometerKm !== null && input.odometerKm < vehicle.odometerKm) throw new ApiError(409, "ODOMETER_CANNOT_DECREASE", "El kilometraje no puede ser menor al último valor registrado.");
  return database.$transaction(async (transaction) => {
    const tank = await transaction.vehicleFuelTank.findFirst({ where: { id: input.tankId, vehicleId: vehicle.id, ...scopeWhere(target), status: "ACTIVE" } });
    if (!tank) throw new ApiError(404, "FUEL_TANK_NOT_FOUND", "El tanque activo no está configurado para este vehículo.");
    if (input.quantity > tank.capacity.toNumber()) throw new ApiError(400, "FUEL_QUANTITY_EXCEEDS_TANK", "La carga supera la capacidad configurada del tanque.");
    const lastRecord = await transaction.fuelRecord.findFirst({ where: { vehicleId: vehicle.id }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], select: { odometerKm: true } });
    if (lastRecord && input.odometerKm < lastRecord.odometerKm) throw new ApiError(409, "ODOMETER_CANNOT_DECREASE", "El kilometraje no puede ser menor al último registrado en combustible.");
    const row = await transaction.fuelRecord.create({ data: {
      organizationId: target.organizationId, companyId: target.companyId, branchId: target.branchId,
      vehicleId: vehicle.id, tankId: tank.id, fuelType: tank.fuelType, unit: tank.unit,
      quantity: input.quantity, costAmount: input.costAmount, currencyCode: input.currencyCode,
      odometerKm: input.odometerKm, occurredAt: input.occurredAt, provider: input.provider,
    }, include: { tank: { select: { name: true } } } });
    if (vehicle.odometerKm === null || input.odometerKm > vehicle.odometerKm) await transaction.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: input.odometerKm } });
    await base.audit(bearer, target, {
      action: "FUEL_RECORD_CREATED", resourceType: "transport.fuel_record", resourceId: row.id,
      after: { vehicleId: row.vehicleId, tankId: row.tankId, fuelType: row.fuelType, unit: row.unit, quantity: row.quantity.toNumber(), costAmount: row.costAmount.toNumber(), currencyCode: row.currencyCode, odometerKm: row.odometerKm },
    });
    return mapFuelRecord(row);
  });
}

export async function fuelSummary(database: PrismaClient, target: AuthorizedTarget, vehicleId?: string): Promise<FuelSummaryItem[]> {
  const rows = await database.fuelRecord.groupBy({
    by: ["fuelType", "unit", "currencyCode"],
    where: { ...scopeWhere(target), ...(vehicleId ? { vehicleId } : {}) },
    _sum: { quantity: true, costAmount: true },
    _count: { _all: true },
    orderBy: [{ fuelType: "asc" }, { unit: "asc" }, { currencyCode: "asc" }],
  });
  return rows.map((row) => ({
    fuelType: row.fuelType, unit: row.unit, quantity: row._sum.quantity?.toNumber() ?? 0,
    costAmount: row._sum.costAmount?.toNumber() ?? 0, currencyCode: row.currencyCode.trim(), records: row._count._all,
  }));
}
