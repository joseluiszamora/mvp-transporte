import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { DocumentOwnerType, FuelType, FuelUnit, MaintenanceRecordStatus, MaintenanceType, ResourceDocumentItem } from "@mvp-transporte/shared-contracts";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import { getVehicle } from "../vehicles/vehicle-service.ts";
import type { AuthorizedTarget, BaseIntegrationClient } from "../integrations/base-client.ts";
import {
  assertRenewalTarget, createDocument, createFuelRecord, createFuelTank, createMaintenancePlan,
  createMaintenanceRecord, fuelSummary, getDocument, listDocuments, listFuelRecords, listFuelTanks,
  listMaintenancePlans, listMaintenanceRecords, updateFuelTankStatus, updateMaintenancePlanStatus,
  updateMaintenanceRecord,
} from "./resource-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => { void handler(request, response, next).catch(next); };

function bearer(request: Request): string {
  const value = request.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!value) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiError(400, "INVALID_REQUEST", "La solicitud contiene campos no permitidos.");
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function id(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function text(value: unknown, label: string, maximum: number, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum || /[\0\r\n]/u.test(normalized)) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
  return normalized;
}

function number(value: unknown, label: string, optional = false, decimals = 0, maximum = 2_000_000_000): number | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
  if (Math.round(value * 10 ** decimals) !== value * 10 ** decimals) throw new ApiError(400, "INVALID_REQUEST", `${label} tiene demasiados decimales.`);
  return value;
}

function dateOnly(value: unknown, label: string, optional = false): Date | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válida.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válida.`);
  return parsed;
}

function dateTime(value: unknown, label: string, optional = false): Date | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válida.`);
  return new Date(value);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value === "string" && values.includes(value as T)) return value as T;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function queryValue(request: Request, name: string, required = false): string | undefined {
  const value = request.query[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 120 || /[\0\r\n]/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", "La consulta no es válida.");
  return value.trim() || undefined;
}

function optionalUuid(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function permissionForFiles(ownerType: DocumentOwnerType, action: "read" | "upload" | "download"): string {
  return `transport.${ownerType === "VEHICLE" ? "vehicle" : "employee"}_files.${action}`;
}

interface ResolvedOwner {
  ownerType: DocumentOwnerType;
  ownerId: string;
  companyId: string;
  branchId: string | null;
}

async function resolveOwner(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearerToken: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
  companyId?: string,
): Promise<ResolvedOwner> {
  if (ownerType === "VEHICLE") {
    const vehicle = await getVehicle(database, ownerId);
    if (companyId && vehicle.companyId !== companyId) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    return { ownerType, ownerId, companyId: vehicle.companyId, branchId: vehicle.branchId };
  }
  const employee = await base.getEmployee(bearerToken, ownerId);
  if (companyId && employee.companyId !== companyId) throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
  return { ownerType, ownerId, companyId: employee.companyId, branchId: null };
}

async function authorizeOwner(
  base: BaseIntegrationClient,
  bearerToken: string,
  owner: ResolvedOwner,
  permissionCode: string,
): Promise<AuthorizedTarget> {
  return base.authorize(bearerToken, permissionCode, owner.companyId, owner.branchId);
}

async function vehicleScope(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearerToken: string,
  vehicleId: string,
  permissionCode: string,
  companyId?: string,
): Promise<{ vehicle: Awaited<ReturnType<typeof getVehicle>>; target: AuthorizedTarget }> {
  const vehicle = await getVehicle(database, vehicleId);
  if (companyId && companyId !== vehicle.companyId) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
  const target = await base.authorize(bearerToken, permissionCode, vehicle.companyId, vehicle.branchId);
  return { vehicle, target };
}

async function listTarget(
  base: BaseIntegrationClient,
  bearerToken: string,
  request: Request,
  permissionCode: string,
): Promise<AuthorizedTarget> {
  const companyId = id(queryValue(request, "companyId", true), "La empresa");
  const branchId = optionalUuid(queryValue(request, "branchId"), "La sucursal");
  return base.authorize(bearerToken, permissionCode, companyId, branchId);
}

function parseFuelUnitForType(fuelType: FuelType, value: unknown): FuelUnit {
  const unit = enumValue(value, ["LITER", "CUBIC_METER", "KILOGRAM"] as const, "La unidad");
  if ((fuelType === "GASOLINE" && unit !== "LITER") || (fuelType === "GNV" && unit === "LITER")) {
    throw new ApiError(400, "INVALID_FUEL_UNIT", "La unidad no corresponde al tipo de combustible.");
  }
  return unit;
}

function attachmentName(value: string): string {
  return value.replace(/[\r\n\0]/gu, "_").replace(/[^\x20-\x7e]/gu, "_").replace(/"/gu, "_").slice(0, 120) || "documento";
}

export function createResourcesRouter(database: PrismaClient, base: BaseIntegrationClient): Router {
  const router = Router();

  router.get("/documents/:ownerType/:ownerId", asyncRoute(async (request, response) => {
    const ownerType = enumValue(request.params.ownerType, ["VEHICLE", "EMPLOYEE"] as const, "El tipo de recurso");
    const ownerId = id(request.params.ownerId, "El recurso");
    const token = bearer(request);
    const owner = await resolveOwner(database, base, token, ownerType, ownerId, queryValue(request, "companyId"));
    const target = await authorizeOwner(base, token, owner, "transport.documents.read");
    await authorizeOwner(base, token, owner, permissionForFiles(ownerType, "read"));
    response.status(200).json({ items: await listDocuments(database, base, token, ownerType, ownerId, target) });
  }));

  router.post("/documents/:ownerType/:ownerId/upload", express.raw({ type: "multipart/form-data", limit: "11mb" }), asyncRoute(async (request, response) => {
    const ownerType = enumValue(request.params.ownerType, ["VEHICLE", "EMPLOYEE"] as const, "El tipo de recurso");
    const ownerId = id(request.params.ownerId, "El recurso");
    const token = bearer(request);
    const owner = await resolveOwner(database, base, token, ownerType, ownerId, queryValue(request, "companyId"));
    const target = await authorizeOwner(base, token, owner, "transport.documents.manage");
    await authorizeOwner(base, token, owner, permissionForFiles(ownerType, "upload"));
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    const contentType = request.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;\s*boundary=/iu.test(contentType) || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      throw new ApiError(400, "INVALID_UPLOAD", "Selecciona un archivo PDF o imagen válido.");
    }
    const documentType = text(queryValue(request, "documentType", true), "El tipo de documento", 60) as string;
    const issuedAt = dateOnly(queryValue(request, "issuedAt"), "La fecha de emisión", true);
    const expiresAt = dateOnly(queryValue(request, "expiresAt"), "La fecha de vencimiento", true);
    const supersedesId = queryValue(request, "supersedesId") ? id(queryValue(request, "supersedesId"), "El documento anterior") : null;
    if (issuedAt && expiresAt && expiresAt < issuedAt) throw new ApiError(400, "INVALID_REQUEST", "El vencimiento no puede ser anterior a la emisión.");
    if (supersedesId) await assertRenewalTarget(database, supersedesId, ownerType, ownerId, target, documentType);
    const file = await base.uploadExternalFile(token, ownerType, ownerId, target, request.body, contentType);
    let item: ResourceDocumentItem;
    try {
      item = await createDocument(database, base, token, ownerType, ownerId, target, {
        documentType, issuedAt, expiresAt, supersedesId, fileId: file.id,
      });
    } catch (error) {
      await base.deleteExternalFile(token, file.id).catch(() => undefined);
      throw error;
    }
    response.status(201).json({ item: { ...item, originalName: file.originalName, detectedMime: file.detectedMime, bytes: file.bytes, canDownload: file.canDownload } });
  }));

  router.get("/documents/:documentId/content", asyncRoute(async (request, response) => {
    const documentId = id(request.params.documentId, "El documento");
    const token = bearer(request);
    const document = await getDocument(database, documentId);
    const ownerType = document.ownerType;
    const ownerId = ownerType === "VEHICLE" ? document.vehicleId as string : document.employeeId as string;
    const owner = await resolveOwner(database, base, token, ownerType, ownerId, document.companyId);
    await authorizeOwner(base, token, owner, "transport.documents.read");
    await authorizeOwner(base, token, owner, permissionForFiles(ownerType, "download"));
    const file = await base.downloadExternalFile(token, document.fileId);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${attachmentName(file.originalName)}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).send(file.body);
  }));

  router.get("/maintenance/plans", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const target = await listTarget(base, token, request, "transport.maintenance.read");
    const vehicleId = optionalUuid(queryValue(request, "vehicleId"), "El vehículo");
    response.status(200).json({ items: await listMaintenancePlans(database, target, vehicleId) });
  }));

  router.post("/maintenance/plans", asyncRoute(async (request, response) => {
    const body = record(request.body);
    onlyKeys(body, ["companyId", "vehicleId", "name", "intervalKm", "intervalDays", "windowDays"]);
    const vehicleId = id(body.vehicleId, "El vehículo");
    const token = bearer(request);
    const { vehicle, target } = await vehicleScope(database, base, token, vehicleId, "transport.maintenance.manage", id(body.companyId, "La empresa"));
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    const intervalKm = number(body.intervalKm, "El intervalo en km", true);
    const intervalDays = number(body.intervalDays, "El intervalo en días", true);
    if (intervalKm === null && intervalDays === null) throw new ApiError(400, "INVALID_REQUEST", "Define un intervalo en kilómetros o días.");
    const windowDays = number(body.windowDays ?? 15, "La ventana de fechas", false);
    if (windowDays === null || windowDays > 365) throw new ApiError(400, "INVALID_REQUEST", "La ventana no puede superar 365 días.");
    const item = await createMaintenancePlan(database, base, token, target, vehicle, {
      name: text(body.name, "El nombre del plan", 100) as string, intervalKm, intervalDays, windowDays,
    });
    response.status(201).json({ item });
  }));

  router.patch("/maintenance/plans/:planId", asyncRoute(async (request, response) => {
    const planId = id(request.params.planId, "El plan");
    const body = record(request.body);
    if (Object.keys(body).length !== 1) throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const status = enumValue(body.status, ["ACTIVE", "INACTIVE"] as const, "El estado");
    const token = bearer(request);
    const current = await database.maintenancePlan.findUnique({ where: { id: planId } });
    if (!current) throw new ApiError(404, "MAINTENANCE_PLAN_NOT_FOUND", "El plan no está disponible.");
    const target = await base.authorize(token, "transport.maintenance.manage", current.companyId, current.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(200).json({ item: await updateMaintenancePlanStatus(database, base, token, target, planId, status) });
  }));

  router.get("/maintenance/records", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const target = await listTarget(base, token, request, "transport.maintenance.read");
    const vehicleId = optionalUuid(queryValue(request, "vehicleId"), "El vehículo");
    response.status(200).json({ items: await listMaintenanceRecords(database, target, vehicleId) });
  }));

  router.post("/maintenance/records", asyncRoute(async (request, response) => {
    const body = record(request.body);
    onlyKeys(body, ["companyId", "vehicleId", "planId", "type", "description", "provider", "scheduledAt", "status", "outOfService", "odometerKm", "costAmount", "currencyCode"]);
    const vehicleId = id(body.vehicleId, "El vehículo");
    const token = bearer(request);
    const { vehicle, target } = await vehicleScope(database, base, token, vehicleId, "transport.maintenance.manage", id(body.companyId, "La empresa"));
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    const costAmount = number(body.costAmount, "El costo", true, 2, 999_999_999.99);
    const currencyCode = String(body.currencyCode ?? "BOB").trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currencyCode)) throw new ApiError(400, "INVALID_REQUEST", "La moneda debe usar un código de tres letras.");
    const item = await createMaintenanceRecord(database, base, token, target, vehicle, {
      planId: body.planId === null || body.planId === undefined || body.planId === "" ? null : id(body.planId, "El plan"),
      type: enumValue(body.type, ["PREVENTIVE", "CORRECTIVE"] as const, "El tipo de mantenimiento") as MaintenanceType,
      description: text(body.description, "La descripción", 500) as string,
      provider: text(body.provider, "El proveedor", 120, true),
      scheduledAt: dateOnly(body.scheduledAt, "La fecha programada", true),
      status: enumValue(body.status ?? "SCHEDULED", ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const, "El estado") as MaintenanceRecordStatus,
      outOfService: optionalBoolean(body.outOfService, "La condición fuera de servicio") ?? false,
      odometerKm: number(body.odometerKm, "El kilometraje", true), costAmount, currencyCode,
    });
    response.status(201).json({ item });
  }));

  router.patch("/maintenance/records/:recordId", asyncRoute(async (request, response) => {
    const recordId = id(request.params.recordId, "El mantenimiento");
    const body = record(request.body);
    if (Object.keys(body).some((key) => !["status", "outOfService", "odometerKm"].includes(key)) || body.status === undefined) {
      throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    const token = bearer(request);
    const current = await database.maintenanceRecord.findUnique({ where: { id: recordId } });
    if (!current) throw new ApiError(404, "MAINTENANCE_RECORD_NOT_FOUND", "El mantenimiento no está disponible.");
    const target = await base.authorize(token, "transport.maintenance.manage", current.companyId, current.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    const odometerKm = body.odometerKm === undefined ? undefined : number(body.odometerKm, "El kilometraje", true);
    response.status(200).json({ item: await updateMaintenanceRecord(database, base, token, target, recordId, {
      status: enumValue(body.status, ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const, "El estado"),
      ...(body.outOfService === undefined ? {} : { outOfService: optionalBoolean(body.outOfService, "La condición fuera de servicio") as boolean }),
      ...(odometerKm === undefined ? {} : { odometerKm }),
    }) });
  }));

  router.get("/fuel/tanks", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const target = await listTarget(base, token, request, "transport.fuel.read");
    const vehicleId = optionalUuid(queryValue(request, "vehicleId"), "El vehículo");
    response.status(200).json({ items: await listFuelTanks(database, target, vehicleId) });
  }));

  router.post("/fuel/tanks", asyncRoute(async (request, response) => {
    const body = record(request.body);
    onlyKeys(body, ["companyId", "vehicleId", "name", "fuelType", "unit", "capacity"]);
    const vehicleId = id(body.vehicleId, "El vehículo");
    const fuelType = enumValue(body.fuelType, ["GASOLINE", "GNV"] as const, "El combustible") as FuelType;
    const unit = parseFuelUnitForType(fuelType, body.unit);
    const capacity = number(body.capacity, "La capacidad", false, 3, 999_999_999.999);
    if (!capacity || capacity <= 0) throw new ApiError(400, "INVALID_REQUEST", "La capacidad debe ser positiva.");
    const token = bearer(request);
    const { vehicle, target } = await vehicleScope(database, base, token, vehicleId, "transport.fuel.manage", id(body.companyId, "La empresa"));
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(201).json({ item: await createFuelTank(database, base, token, target, vehicle, {
      name: text(body.name, "El nombre del tanque", 80) as string, fuelType, unit, capacity,
    }) });
  }));

  router.patch("/fuel/tanks/:tankId", asyncRoute(async (request, response) => {
    const tankId = id(request.params.tankId, "El tanque");
    const body = record(request.body);
    if (Object.keys(body).length !== 1) throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const status = enumValue(body.status, ["ACTIVE", "INACTIVE"] as const, "El estado");
    const token = bearer(request);
    const tank = await database.vehicleFuelTank.findUnique({ where: { id: tankId } });
    if (!tank) throw new ApiError(404, "FUEL_TANK_NOT_FOUND", "El tanque no está disponible.");
    const target = await base.authorize(token, "transport.fuel.manage", tank.companyId, tank.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(200).json({ item: await updateFuelTankStatus(database, base, token, target, tankId, status) });
  }));

  router.get("/fuel/records", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const target = await listTarget(base, token, request, "transport.fuel.read");
    const vehicleId = optionalUuid(queryValue(request, "vehicleId"), "El vehículo");
    response.status(200).json({ items: await listFuelRecords(database, target, vehicleId) });
  }));

  router.post("/fuel/records", asyncRoute(async (request, response) => {
    const body = record(request.body);
    onlyKeys(body, ["companyId", "vehicleId", "tankId", "quantity", "costAmount", "currencyCode", "odometerKm", "occurredAt", "provider"]);
    const vehicleId = id(body.vehicleId, "El vehículo");
    const token = bearer(request);
    const { vehicle, target } = await vehicleScope(database, base, token, vehicleId, "transport.fuel.manage", id(body.companyId, "La empresa"));
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    const costAmount = number(body.costAmount, "El costo", false, 2, 999_999_999.99);
    if (costAmount === null) throw new ApiError(400, "INVALID_REQUEST", "El costo es obligatorio.");
    const quantity = number(body.quantity, "La cantidad", false, 3, 999_999_999.999);
    if (quantity === null || quantity <= 0) throw new ApiError(400, "INVALID_REQUEST", "La cantidad debe ser positiva.");
    const currencyCode = String(body.currencyCode ?? "BOB").trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currencyCode)) throw new ApiError(400, "INVALID_REQUEST", "La moneda debe usar un código de tres letras.");
    response.status(201).json({ item: await createFuelRecord(database, base, token, target, vehicle, {
      tankId: id(body.tankId, "El tanque"), quantity, costAmount, currencyCode,
      odometerKm: number(body.odometerKm, "El kilometraje") as number,
      occurredAt: dateTime(body.occurredAt, "La fecha de carga", true) ?? new Date(),
      provider: text(body.provider, "El proveedor", 120, true),
    }) });
  }));

  router.get("/fuel/summary", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const target = await listTarget(base, token, request, "transport.fuel.read");
    const vehicleId = optionalUuid(queryValue(request, "vehicleId"), "El vehículo");
    response.status(200).json({ items: await fuelSummary(database, target, vehicleId) });
  }));

  return router;
}
