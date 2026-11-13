import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { BaseIntegrationClient, AuthorizedTarget } from "../integrations/base-client.ts";
import { getDriverTrip, listDriverTrips, transitionTrip } from "../trips/trips-service.ts";
import type { TripStatus } from "@mvp-transporte/shared-contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tripStatuses = new Set<TripStatus>(["PLANNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => { void action(request, response).catch(next); };
}

function bearer(request: Request): string {
  const match = request.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return match[1];
}

function uuid(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new ApiError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function queryInteger(request: Request, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = request.query[key];
  const value = raw === undefined ? String(fallback) : raw;
  if (typeof value !== "string" || !/^\d{1,9}$/u.test(value)) throw new ApiError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApiError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function requireStatus(value: unknown): TripStatus {
  if (typeof value === "string" && tripStatuses.has(value as TripStatus)) return value as TripStatus;
  throw new ApiError(400, "INVALID_REQUEST", "El estado del viaje no es válido.");
}

async function requireDriverContext(
  database: PrismaClient,
  base: BaseIntegrationClient,
  token: string,
  permission: "transport.driver_trips.read" | "transport.driver_trips.transition",
): Promise<{ employeeId: string; target: AuthorizedTarget }> {
  const employee = await base.getCurrentEmployee(token);
  const target = await base.authorize(token, permission, employee.companyId);
  if (target.organizationId !== employee.organizationId || target.companyId !== employee.companyId || target.branchId !== null) {
    throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió un alcance de conductor no válido.");
  }
  const profile = await database.driverProfile.findFirst({
    where: { organizationId: employee.organizationId, companyId: employee.companyId, employeeId: employee.employeeId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!profile) throw new ApiError(403, "DRIVER_PROFILE_REQUIRED", "Tu empleado no tiene un perfil activo de conductor en Transporte.");
  return { employeeId: employee.employeeId, target };
}

function requireSameActor(expected: AuthorizedTarget, actual: AuthorizedTarget): void {
  if (expected.actorId !== actual.actorId || expected.organizationId !== actual.organizationId || expected.companyId !== actual.companyId) {
    throw new ApiError(401, "SESSION_CHANGED", "La sesión cambió. Inicia sesión nuevamente.");
  }
}

export function createDriverRouter(database: PrismaClient, base: BaseIntegrationClient): Router {
  const router = Router();

  router.get("/trips", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const { employeeId, target } = await requireDriverContext(database, base, token, "transport.driver_trips.read");
    const rawStatus = request.query.status;
    const status = rawStatus === undefined ? undefined : requireStatus(rawStatus);
    response.status(200).json(await listDriverTrips(database, target, employeeId, {
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      ...(status ? { status } : {}),
    }));
  }));

  router.get("/trips/:tripId", asyncRoute(async (request, response) => {
    const token = bearer(request);
    const { employeeId, target } = await requireDriverContext(database, base, token, "transport.driver_trips.read");
    const item = await getDriverTrip(database, target, employeeId, uuid(request.params.tripId, "El viaje"));
    response.status(200).json({ item });
  }));

  router.patch("/trips/:tripId/status", asyncRoute(async (request, response) => {
    if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const body = request.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "status")) throw new ApiError(400, "INVALID_REQUEST", "La solicitud contiene campos no permitidos.");
    const status = requireStatus(body.status);
    if (status !== "IN_PROGRESS" && status !== "COMPLETED") throw new ApiError(403, "DRIVER_TRANSITION_FORBIDDEN", "El conductor solo puede iniciar o completar su viaje.");

    const token = bearer(request);
    const { employeeId, target } = await requireDriverContext(database, base, token, "transport.driver_trips.transition");
    const auditTarget = await base.authorize(token, "transport.audit.write", target.companyId);
    requireSameActor(target, auditTarget);
    const tripId = uuid(request.params.tripId, "El viaje");
    await transitionTrip(database, base, token, target, tripId, { status }, employeeId);
    response.status(200).json({ item: await getDriverTrip(database, target, employeeId, tripId) });
  }));

  return router;
}
