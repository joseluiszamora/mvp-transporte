import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { BaseIntegrationClient } from "../integrations/base-client.ts";
import { createVehicle, getVehicle, listVehicles, updateVehicle, type VehicleCreateInput, type VehicleUpdateInput } from "./vehicle-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const createFields = new Set(["companyId", "branchId", "plate", "vehicleType", "make", "model", "year", "capacityKg", "odometerKm"]);
const updateFields = new Set(["plate", "vehicleType", "make", "model", "year", "capacityKg", "odometerKm", "status"]);

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch(next);
  };
}

function bearer(request: Request): string {
  const header = request.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return match[1];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
}

function requiredText(value: unknown, name: string, max: number, pattern?: RegExp): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_REQUEST", `${name} no es válido.`);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > max || /[\0\r\n]/u.test(normalized) || (pattern && !pattern.test(normalized))) {
    throw new ApiError(400, "INVALID_REQUEST", `${name} no es válido.`);
  }
  return normalized;
}

function uuid(value: unknown, name: string, optional = false): string | null {
  if (optional && value === undefined) return null;
  if (optional && value === null) return null;
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", `${name} no es válido.`);
}

function number(value: unknown, name: string, optional: boolean, minimum: number, maximum: number, decimals = 0): number | null {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ApiError(400, "INVALID_REQUEST", `${name} no es válido.`);
  }
  const multiplier = 10 ** decimals;
  if (Math.round(value * multiplier) !== value * multiplier) throw new ApiError(400, "INVALID_REQUEST", `${name} tiene demasiados decimales.`);
  return value;
}

function parseCreate(value: unknown): { companyId: string; branchId: string | null; input: VehicleCreateInput } {
  const body = record(value);
  if (Object.keys(body).some((key) => !createFields.has(key))) throw new ApiError(400, "INVALID_REQUEST", "La solicitud contiene campos no permitidos.");
  const plate = requiredText(body.plate, "La placa", 20, /^[A-Za-z0-9 -]{3,20}$/u);
  if (plate.replace(/[\s-]+/gu, "").length < 3) throw new ApiError(400, "INVALID_REQUEST", "La placa no es válida.");
  return {
    companyId: uuid(body.companyId, "La empresa") as string,
    branchId: uuid(body.branchId, "La sucursal", true),
    input: {
      plate,
      vehicleType: requiredText(body.vehicleType, "El tipo de vehículo", 40, /^[A-Za-z0-9 _-]+$/u),
      make: requiredText(body.make, "La marca", 80),
      model: requiredText(body.model, "El modelo", 80),
      year: number(body.year, "El año", true, 1886, 2200),
      capacityKg: number(body.capacityKg, "La capacidad en kg", false, 0.01, 9_999_999_999.99, 2) as number,
      odometerKm: number(body.odometerKm, "El kilometraje", true, 0, 2_000_000_000),
    },
  };
}

function parseUpdate(value: unknown): VehicleUpdateInput {
  const body = record(value);
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !updateFields.has(key))) {
    throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  const input: VehicleUpdateInput = {};
  if (body.plate !== undefined) input.plate = requiredText(body.plate, "La placa", 20, /^[A-Za-z0-9 -]{3,20}$/u);
  if (body.vehicleType !== undefined) input.vehicleType = requiredText(body.vehicleType, "El tipo de vehículo", 40, /^[A-Za-z0-9 _-]+$/u);
  if (body.make !== undefined) input.make = requiredText(body.make, "La marca", 80);
  if (body.model !== undefined) input.model = requiredText(body.model, "El modelo", 80);
  if (body.year !== undefined) input.year = number(body.year, "El año", true, 1886, 2200);
  if (body.capacityKg !== undefined) input.capacityKg = number(body.capacityKg, "La capacidad en kg", false, 0.01, 9_999_999_999.99, 2) as number;
  if (body.odometerKm !== undefined) input.odometerKm = number(body.odometerKm, "El kilometraje", true, 0, 2_000_000_000);
  if (body.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "INACTIVE") throw new ApiError(400, "INVALID_REQUEST", "El estado no es válido.");
    input.status = body.status;
  }
  return input;
}

function queryText(request: Request, name: string, required = false): string | undefined {
  const value = request.query[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 120 || /[\0\r\n]/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", "La consulta no es válida.");
  return value.trim() || undefined;
}

function queryInteger(request: Request, name: string, fallback: number, min: number, max: number): number {
  const raw = request.query[name];
  const value = typeof raw === "string" ? raw : String(fallback);
  if (!/^\d{1,9}$/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ApiError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function requireId(request: Request): string {
  const value = request.params.vehicleId;
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", "El vehículo no es válido.");
}

export function createVehiclesRouter(database: PrismaClient, base: BaseIntegrationClient): Router {
  const router = Router();

  router.get("/", asyncRoute(async (request, response) => {
    const companyId = uuid(queryText(request, "companyId", true), "La empresa") as string;
    const branchId = uuid(queryText(request, "branchId"), "La sucursal", true);
    const access = await base.authorize(bearer(request), "transport.vehicles.read", companyId, branchId);
    const status = queryText(request, "status");
    if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE") throw new ApiError(400, "INVALID_REQUEST", "El estado no es válido.");
    const search = queryText(request, "search");
    const vehicleType = queryText(request, "vehicleType");
    const page = await listVehicles(database, {
      target: access,
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      ...(search !== undefined ? { search } : {}),
      ...(vehicleType !== undefined ? { vehicleType } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    response.status(200).json(page);
  }));

  router.post("/", asyncRoute(async (request, response) => {
    const { companyId, branchId, input } = parseCreate(request.body);
    const token = bearer(request);
    const access = await base.authorize(token, "transport.vehicles.create", companyId, branchId);
    await base.authorize(token, "transport.audit.write", access.companyId, access.branchId);
    const item = await createVehicle(database, base, token, access, input);
    response.status(201).json({ item });
  }));

  router.get("/:vehicleId", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const item = await getVehicle(database, requireId(request));
    await base.authorize(token, "transport.vehicles.read", item.companyId, item.branchId);
    response.status(200).json({ item });
  }));

  router.patch("/:vehicleId", asyncRoute(async (request, response) => {
    const id = requireId(request);
    const input = parseUpdate(request.body);
    if (input.status === "INACTIVE" && Object.keys(input).length !== 1) {
      throw new ApiError(400, "INVALID_REQUEST", "Desactiva el vehículo en una solicitud separada de la edición.");
    }
    const token = bearer(request);
    const current = await getVehicle(database, id);
    const permission = input.status === "INACTIVE" ? "transport.vehicles.deactivate" : "transport.vehicles.update";
    const access = await base.authorize(token, permission, current.companyId, current.branchId);
    await base.authorize(token, "transport.audit.write", access.companyId, access.branchId);
    const item = await updateVehicle(database, base, token, access, id, input);
    response.status(200).json({ item });
  }));

  return router;
}
