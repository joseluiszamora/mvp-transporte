import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import {
  createNumberSequence,
  getBusinessHours,
  getEffectiveSettings,
  getInstallationSettings,
  issueNumber,
  listNumberSequences,
  listScopeOptions,
  listSettings,
  replaceBusinessHours,
  updateInstallationSetting,
  updateNumberSequence,
  updateSetting,
  type BusinessHourInterval,
  type SettingScope,
} from "./settings-service.ts";

function bodyRecord(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function bodyString(key: string, maximum: number, optional = false, allowEmpty = false) {
  return (request: Request): string | undefined => {
    const value = bodyRecord(request)[key];
    if (value === undefined && optional) return undefined;
    if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum) {
      throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    return value;
  };
}

function bodyUuid(key: string, optional = false): (request: Request) => string | undefined {
  return (request) => {
    const value = bodyRecord(request)[key];
    if (value === undefined && optional) return undefined;
    if (typeof value !== "string" || !isUuid(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    return value;
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function queryUuid(request: Request, key: string, required = false): string | undefined {
  const value = request.query[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !isUuid(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance indicado no es válido.");
  return value;
}

function queryText(request: Request, key: string): string | undefined {
  const value = request.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  return value;
}

function queryInteger(request: Request, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = request.query[key];
  const text = typeof value === "string" ? value : String(fallback);
  if (!/^\d{1,9}$/u.test(text)) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function scopeValue(value: unknown): Exclude<SettingScope, "INSTALLATION"> {
  if (value === "ORGANIZATION" || value === "COMPANY" || value === "BRANCH") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no es válido.");
}

function bodySettingValue(request: Request): unknown {
  if (!Object.hasOwn(bodyRecord(request), "value")) throw new AuthServiceError(400, "INVALID_REQUEST", "El valor es obligatorio.");
  return bodyRecord(request).value;
}

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch((error: unknown) => {
      if (response.headersSent) next(error);
      else sendAuthError(response, error);
    });
  };
}

function requestId(response: Response): string {
  return (response.locals as AuthLocals).requestId;
}

function requireAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.get("origin");
  if (origin && !allowedOrigins.has(origin)) throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
}

function requireRequestContext(database: Pool | undefined, response: Response) {
  const session = getAuthenticatedSession(response);
  if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return { database, session };
}

function parseBusinessDays(request: Request): Array<{ weekday: number; intervals: BusinessHourInterval[] }> {
  const days = bodyRecord(request).days;
  if (!Array.isArray(days)) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "La lista de horarios no es válida.");
  return days.map((day) => {
    if (typeof day !== "object" || day === null || Array.isArray(day)) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "La lista de horarios no es válida.");
    const row = day as Record<string, unknown>;
    if (typeof row.weekday !== "number" || !Number.isInteger(row.weekday) || !Array.isArray(row.intervals)) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "La lista de horarios no es válida.");
    const intervals = row.intervals.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Un bloque horario no es válido.");
      const interval = item as Record<string, unknown>;
      if (typeof interval.start !== "string" || typeof interval.end !== "string") throw new AuthServiceError(400, "INVALID_BUSINESS_HOURS", "Un bloque horario no es válido.");
      return { start: interval.start, end: interval.end };
    });
    return { weekday: row.weekday, intervals };
  });
}

export function createSettingsRouter(database: Pool | undefined, settings: AuthSettings, allowedOrigins: readonly string[]): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(database, settings);
  const origins = new Set(allowedOrigins);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  router.get("/scope-options", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await listScopeOptions(db, session, {
      limit: queryInteger(request, "limit", 100, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"),
      companyId: queryUuid(request, "companyId"),
    }));
  }));

  router.get("/effective", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await getEffectiveSettings(db, session, {
      companyId: queryUuid(request, "companyId"),
      branchId: queryUuid(request, "branchId"),
    }));
  }));

  router.get("/installation", authenticate, asyncRoute(async (_request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await getInstallationSettings(db, session));
  }));

  router.put("/installation", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await updateInstallationSetting(db, session, {
      key: bodyString("key", 80)(request) as string,
      value: bodySettingValue(request),
      requestId: requestId(response),
    }));
  }));

  router.get("/business-hours", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    const companyId = queryUuid(request, "companyId", true) as string;
    response.status(200).json(await getBusinessHours(db, session, { companyId, branchId: queryUuid(request, "branchId") }));
  }));

  router.put("/business-hours", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await replaceBusinessHours(db, session, {
      companyId: bodyUuid("companyId")(request) as string,
      branchId: bodyUuid("branchId", true)(request),
      days: parseBusinessDays(request),
      requestId: requestId(response),
    }));
  }));

  router.get("/number-sequences", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    response.status(200).json(await listNumberSequences(db, session, {
      companyId: queryUuid(request, "companyId"), branchId: queryUuid(request, "branchId"),
      limit: queryInteger(request, "limit", 20, 1, 100), offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"),
    }));
  }));

  router.post("/number-sequences", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    const padding = bodyRecord(request).padding;
    if (typeof padding !== "number" || !Number.isInteger(padding)) throw new AuthServiceError(400, "INVALID_REQUEST", "El relleno no es válido.");
    response.status(201).json(await createNumberSequence(db, session, {
      companyId: bodyUuid("companyId", true)(request), branchId: bodyUuid("branchId", true)(request),
      documentType: bodyString("documentType", 80)(request) as string,
      period: bodyString("period", 16)(request) as string,
      prefix: bodyString("prefix", 24, false, true)(request) as string,
      padding,
      requestId: requestId(response),
    }));
  }));

  router.patch("/number-sequences/:sequenceId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    if (!isUuid(request.params.sequenceId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La numeración no es válida.");
    const padding = bodyRecord(request).padding;
    if (padding !== undefined && (typeof padding !== "number" || !Number.isInteger(padding))) throw new AuthServiceError(400, "INVALID_REQUEST", "El relleno no es válido.");
    response.status(200).json(await updateNumberSequence(db, session, {
      sequenceId: request.params.sequenceId,
      prefix: bodyString("prefix", 24, true, true)(request),
      padding: padding as number | undefined,
      requestId: requestId(response),
    }));
  }));

  router.post("/number-sequences/:sequenceId/next", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    if (!isUuid(request.params.sequenceId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La numeración no es válida.");
    response.status(200).json(await issueNumber(db, session, { sequenceId: request.params.sequenceId, requestId: requestId(response) }));
  }));

  router.get("/", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireRequestContext(database, response);
    const companyId = queryUuid(request, "companyId");
    const branchId = queryUuid(request, "branchId");
    if (branchId && !companyId) throw new AuthServiceError(400, "INVALID_REQUEST", "La sucursal requiere una empresa.");
    response.status(200).json(await listSettings(db, session, {
      companyId, branchId,
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"),
    }));
  }));

  router.put("/", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireRequestContext(database, response);
    const companyId = bodyUuid("companyId", true)(request);
    const branchId = bodyUuid("branchId", true)(request);
    const scopeType = scopeValue(bodyRecord(request).scopeType);
    if ((scopeType === "ORGANIZATION" && (companyId || branchId)) || (scopeType === "COMPANY" && (!companyId || branchId)) || (scopeType === "BRANCH" && (!companyId || !branchId))) {
      throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no coincide con la empresa o sucursal indicada.");
    }
    response.status(200).json(await updateSetting(db, session, {
      scopeType, companyId, branchId,
      key: bodyString("key", 80)(request) as string,
      value: bodySettingValue(request),
      requestId: requestId(response),
    }));
  }));

  return router;
}
