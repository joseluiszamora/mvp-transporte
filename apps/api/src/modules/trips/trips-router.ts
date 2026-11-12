import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { BaseIntegrationClient } from "../integrations/base-client.ts";
import {
  createTrip,
  getTrip,
  listTrips,
  transitionTrip,
  updateTripAssignment,
} from "./trips-service.ts";
import type { TripCommand } from "./trips-service.ts";
import type { TripStatus, TripType } from "@mvp-transporte/shared-contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const tripTypes = new Set<TripType>(["DISTRIBUTION", "SHORT_ROUTE", "LONG_DISTANCE"]);
const tripStatuses = new Set<TripStatus>(["PLANNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => { void action(request, response).catch(next); };
}

function bearer(request: Request): string {
  const match = request.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return match[1];
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiError(400, "INVALID_REQUEST", "La solicitud contiene campos no permitidos.");
}

function uuid(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function text(value: unknown, label: string, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > max || /[\0\r\n]/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ApiError(400, "INVALID_REQUEST", `${label} es obligatorio.`);
  return trimmed || undefined;
}

function dateTime(value: unknown, label: string): Date {
  if (typeof value !== "string" || !dateTimePattern.test(value)) throw new ApiError(400, "INVALID_REQUEST", `${label} debe incluir fecha, hora y zona horaria.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
  return parsed;
}

function parseCrew(value: unknown): TripCommand["crew"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new ApiError(400, "INVALID_REQUEST", "La tripulación no es válida.");
  return value.map((raw, index) => {
    const person = bodyRecord(raw);
    onlyKeys(person, ["role", "source", "employeeId", "externalName", "startsAt", "endsAt"]);
    if (person.role !== "DRIVER" && person.role !== "ASSISTANT") throw new ApiError(400, "INVALID_REQUEST", "El rol de tripulación no es válido.");
    if (person.source !== "INTERNAL" && person.source !== "CLIENT") throw new ApiError(400, "INVALID_REQUEST", "El origen de tripulación no es válido.");
    const employeeId = person.employeeId === undefined || person.employeeId === null ? undefined : uuid(person.employeeId, `El empleado ${index + 1}`);
    const externalName = text(person.externalName, "El nombre externo", 120, false);
    return {
      role: person.role,
      source: person.source,
      ...(employeeId ? { employeeId } : {}),
      ...(externalName ? { externalName } : {}),
      startsAt: dateTime(person.startsAt, "El inicio del intervalo de tripulación"),
      endsAt: dateTime(person.endsAt, "El fin del intervalo de tripulación"),
    };
  });
}

function parseCreate(value: unknown): TripCommand {
  const body = bodyRecord(value);
  onlyKeys(body, ["companyId", "branchId", "type", "vehicleId", "contractingCompanyId", "origin", "destination", "sealNumbers", "plannedStartAt", "plannedEndAt", "stops", "crew"]);
  if (typeof body.type !== "string" || !tripTypes.has(body.type as TripType)) throw new ApiError(400, "INVALID_REQUEST", "El tipo de viaje no es válido.");
  let stops: string[] = [];
  if (body.stops !== undefined) {
    if (!Array.isArray(body.stops) || body.stops.length > 2) throw new ApiError(400, "INVALID_REQUEST", "Las paradas no son válidas.");
    stops = body.stops.map((stop, index) => text(stop, `La parada ${index + 1}`, 160) as string);
  }
  let sealNumbers: string[] = [];
  if (body.sealNumbers !== undefined) {
    if (!Array.isArray(body.sealNumbers) || body.sealNumbers.length > 10) throw new ApiError(400, "INVALID_REQUEST", "Los precintos no son válidos.");
    sealNumbers = body.sealNumbers.map((seal, index) => text(seal, `El precinto ${index + 1}`, 80) as string);
  }
  return {
    companyId: uuid(body.companyId, "La empresa"),
    ...(body.branchId === undefined || body.branchId === null ? {} : { branchId: uuid(body.branchId, "La sucursal") }),
    type: body.type as TripType,
    vehicleId: uuid(body.vehicleId, "El vehículo"),
    ...(body.contractingCompanyId === undefined || body.contractingCompanyId === null ? {} : { contractingCompanyId: uuid(body.contractingCompanyId, "La empresa contratante") }),
    origin: text(body.origin, "El origen", 160) as string,
    destination: text(body.destination, "El destino", 160) as string,
    sealNumbers,
    plannedStartAt: dateTime(body.plannedStartAt, "La fecha de inicio"),
    plannedEndAt: dateTime(body.plannedEndAt, "La fecha de fin"),
    stops,
    crew: parseCrew(body.crew),
  };
}

function parseAssignment(value: unknown): { vehicleId: string; crew: TripCommand["crew"] } {
  const body = bodyRecord(value);
  onlyKeys(body, ["vehicleId", "crew"]);
  if (!Array.isArray(body.crew)) throw new ApiError(400, "INVALID_REQUEST", "La tripulación debe enviarse como una lista.");
  return { vehicleId: uuid(body.vehicleId, "El vehículo"), crew: parseCrew(body.crew) };
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

function parseFilterDate(value: string | undefined, label: string): Date | undefined {
  return value === undefined ? undefined : dateTime(value, label);
}

export function createTripsRouter(database: PrismaClient, base: BaseIntegrationClient): Router {
  const router = Router();

  router.get("/", asyncRoute(async (request, response) => {
    const companyId = uuid(queryText(request, "companyId", true), "La empresa");
    const branchId = queryText(request, "branchId");
    const token = bearer(request);
    const target = await base.authorize(token, "transport.trips.read", companyId, branchId ? uuid(branchId, "La sucursal") : null);
    const rawType = queryText(request, "type");
    const rawStatus = queryText(request, "status");
    if (rawType !== undefined && !tripTypes.has(rawType as TripType)) throw new ApiError(400, "INVALID_REQUEST", "El tipo de viaje no es válido.");
    if (rawStatus !== undefined && !tripStatuses.has(rawStatus as TripStatus)) throw new ApiError(400, "INVALID_REQUEST", "El estado del viaje no es válido.");
    const from = parseFilterDate(queryText(request, "from"), "La fecha inicial");
    const to = parseFilterDate(queryText(request, "to"), "La fecha final");
    if (from && to && from >= to) throw new ApiError(400, "INVALID_REQUEST", "El periodo de consulta no es válido.");
    response.status(200).json(await listTrips(database, target, {
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      ...(rawType ? { type: rawType as TripType } : {}),
      ...(rawStatus ? { status: rawStatus as TripStatus } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }));
  }));

  router.post("/", asyncRoute(async (request, response) => {
    const input = parseCreate(request.body);
    const token = bearer(request);
    const target = await base.authorize(token, "transport.trips.create", input.companyId, input.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(201).json({ item: await createTrip(database, base, token, target, input) });
  }));

  router.get("/:tripId", asyncRoute(async (request, response) => {
    const id = uuid(request.params.tripId, "El viaje");
    const token = bearer(request);
    const trip = await database.trip.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
    const target = await base.authorize(token, "transport.trips.read", trip.companyId, trip.branchId);
    response.status(200).json({ item: await getTrip(database, target, id) });
  }));

  router.put("/:tripId/assignment", asyncRoute(async (request, response) => {
    const id = uuid(request.params.tripId, "El viaje");
    const input = parseAssignment(request.body);
    const token = bearer(request);
    const trip = await database.trip.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
    const target = await base.authorize(token, "transport.trips.assign", trip.companyId, trip.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(200).json({ item: await updateTripAssignment(database, base, token, target, id, input) });
  }));

  router.patch("/:tripId/status", asyncRoute(async (request, response) => {
    const id = uuid(request.params.tripId, "El viaje");
    const body = bodyRecord(request.body);
    onlyKeys(body, ["status", "cancellationReason"]);
    if (typeof body.status !== "string" || !tripStatuses.has(body.status as TripStatus) || body.status === "PLANNED") {
      throw new ApiError(400, "INVALID_REQUEST", "El nuevo estado del viaje no es válido.");
    }
    const cancellationReason = body.cancellationReason === undefined ? undefined : text(body.cancellationReason, "El motivo de cancelación", 300);
    if (body.status !== "CANCELLED" && cancellationReason !== undefined) throw new ApiError(400, "INVALID_REQUEST", "El motivo solo se acepta al cancelar el viaje.");
    const token = bearer(request);
    const trip = await database.trip.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
    const target = await base.authorize(token, "transport.trips.transition", trip.companyId, trip.branchId);
    await base.authorize(token, "transport.audit.write", target.companyId, target.branchId);
    response.status(200).json({ item: await transitionTrip(database, base, token, target, id, {
      status: body.status as Exclude<TripStatus, "PLANNED">,
      ...(cancellationReason ? { cancellationReason } : {}),
    }) });
  }));

  return router;
}
