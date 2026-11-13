import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { BaseIntegrationClient } from "../integrations/base-client.ts";
import { createProfile, listProfiles, updateProfileStatus, type ProfileKind } from "./staff-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function permission(kind: ProfileKind, action: "read" | "manage"): string {
  return `transport.${kind === "driver" ? "driver" : "assistant"}_profiles.${action}`;
}

function createProfileRouter(database: PrismaClient, base: BaseIntegrationClient, kind: ProfileKind): Router {
  const router = Router();

  router.get("/", asyncRoute(async (request, response) => {
    const companyId = uuid(queryText(request, "companyId", true), "La empresa");
    const bearerToken = bearer(request);
    const target = await base.authorize(bearerToken, permission(kind, "read"), companyId);
    const status = queryText(request, "status");
    if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE") throw new ApiError(400, "INVALID_REQUEST", "El estado no es válido.");
    const page = await listProfiles(database, base, bearerToken, kind, target, {
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      ...(status !== undefined ? { status } : {}),
    });
    response.status(200).json(page);
  }));

  router.post("/", asyncRoute(async (request, response) => {
    if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) throw new ApiError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const body = request.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["companyId", "employeeId"].includes(key))) throw new ApiError(400, "INVALID_REQUEST", "La solicitud contiene campos no permitidos.");
    const companyId = uuid(body.companyId, "La empresa");
    const employeeId = uuid(body.employeeId, "El empleado");
    const bearerToken = bearer(request);
    const target = await base.authorize(bearerToken, permission(kind, "manage"), companyId);
    await base.authorize(bearerToken, "transport.audit.write", target.companyId);
    const item = await createProfile(database, base, bearerToken, kind, target, employeeId);
    response.status(201).json({ item });
  }));

  router.patch("/:profileId", asyncRoute(async (request, response) => {
    const id = uuid(request.params.profileId, "El perfil");
    const body = request.body as Record<string, unknown>;
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || (body.status !== "ACTIVE" && body.status !== "INACTIVE")) {
      throw new ApiError(400, "INVALID_REQUEST", "Solo se puede modificar el estado del perfil.");
    }
    const bearerToken = bearer(request);
    const profile = kind === "driver"
      ? await database.driverProfile.findUnique({ where: { id } })
      : await database.assistantProfile.findUnique({ where: { id } });
    if (!profile) throw new ApiError(404, "PROFILE_NOT_FOUND", "El perfil no está disponible.");
    const target = await base.authorize(bearerToken, permission(kind, "manage"), profile.companyId);
    await base.authorize(bearerToken, "transport.audit.write", target.companyId);
    const item = await updateProfileStatus(database, base, bearerToken, kind, target, id, body.status);
    response.status(200).json({ item });
  }));

  return router;
}

export function createOperationalStaffRouter(database: PrismaClient, base: BaseIntegrationClient): Router {
  const router = Router();
  router.get("/employees", asyncRoute(async (request, response) => {
    const companyId = uuid(queryText(request, "companyId", true), "La empresa");
    const token = bearer(request);
    const target = await base.authorize(token, "transport.operational_staff.read", companyId);
    const search = queryText(request, "search");
    const page = await base.listEmployees(token, target.companyId, {
      limit: queryInteger(request, "limit", 100, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      ...(search ? { search } : {}),
      status: "ACTIVE",
    });
    response.status(200).json(page);
  }));
  router.use("/driver-profiles", createProfileRouter(database, base, "driver"));
  router.use("/assistant-profiles", createProfileRouter(database, base, "assistant"));
  return router;
}
