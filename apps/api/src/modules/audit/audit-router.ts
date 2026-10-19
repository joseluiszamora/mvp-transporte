import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import { getAuditEvent, listAuditEvents } from "./audit-query-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const instantPattern = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function uuid(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function queryText(request: Request, key: string, maximum = 100): string | undefined {
  const value = request.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum || /[\0\r\n]/u.test(value)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "Uno de los filtros no es válido.");
  }
  return value.trim() || undefined;
}

function queryInstant(request: Request, key: string): Date | undefined {
  const value = queryText(request, key, 40);
  if (value === undefined) return undefined;
  const match = instantPattern.exec(value);
  if (!match) throw new AuthServiceError(400, "INVALID_REQUEST", "La fecha debe incluir hora y zona horaria ISO 8601.");
  const datePart = `${match[1]}-${match[2]}-${match[3]}`;
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La fecha no es válida.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AuthServiceError(400, "INVALID_REQUEST", "La fecha no es válida.");
  return parsed;
}

function queryInteger(request: Request, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = request.query[key];
  const value = typeof raw === "string" ? raw : String(fallback);
  if (!/^\d{1,9}$/u.test(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch((error: unknown) => {
      if (response.headersSent) next(error);
      else sendAuthError(response, error);
    });
  };
}

function requireContext(database: Pool | undefined, response: Response) {
  const session = getAuthenticatedSession(response);
  if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return { database, session };
}

export function createAuditRouter(database: Pool | undefined, settings: AuthSettings): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(database, settings);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store, private"); next(); });

  router.get("/", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const from = queryInstant(request, "from");
    const to = queryInstant(request, "to");
    if (from && to && from > to) throw new AuthServiceError(400, "INVALID_REQUEST", "La fecha inicial debe ser anterior a la final.");
    const actorId = queryText(request, "actorId", 36);
    if (actorId !== undefined) uuid(actorId, "El actor");
    response.status(200).json(await listAuditEvents(db, session, {
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      from,
      to,
      actorId,
      action: queryText(request, "action"),
      resourceType: queryText(request, "resourceType"),
      resourceId: queryText(request, "resourceId", 100),
    }));
  }));

  router.get("/:eventId", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await getAuditEvent(db, session, uuid(request.params.eventId, "El evento")));
  }));
  return router;
}