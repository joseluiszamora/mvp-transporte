import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import {
  createCatalog,
  createCatalogItem,
  deactivateCatalog,
  deactivateCatalogItem,
  listCatalogItems,
  listCatalogScopeOptions,
  listCatalogs,
  updateCatalog,
  updateCatalogItem,
  type CatalogScope,
  type CatalogRecordStatus,
} from "./catalog-service.ts";

function bodyRecord(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function bodyText(request: Request, key: string, maximumLength: number, optional = false): string | undefined {
  const value = bodyRecord(request)[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return value;
}

function bodyOptionalText(request: Request, key: string, maximumLength: number): string | null | undefined {
  const value = bodyRecord(request)[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return value;
}

function queryInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const text = typeof value === "string" ? value : String(fallback);
  if (!/^\d{1,9}$/u.test(text)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return parsed;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function querySearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  return value;
}

function parseStatus(value: unknown): CatalogRecordStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "ACTIVE" || value === "INACTIVE") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "El estado no es válido.");
}

function parseScope(value: unknown): CatalogScope | undefined {
  if (value === undefined) return undefined;
  if (value === "GLOBAL" || value === "ORGANIZATION" || value === "COMPANY") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no es válido.");
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
  if (origin && !allowedOrigins.has(origin)) {
    throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
  }
}

export function createCatalogRouter(database: Pool | undefined, settings: AuthSettings, allowedOrigins: readonly string[]): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(database, settings);
  const origins = new Set(allowedOrigins);
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listCatalogs(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      search: querySearch(request.query.search),
      status: parseStatus(request.query.status),
      scope: parseScope(request.query.scope),
    }));
  }));

  router.get("/scope-options", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listCatalogScopeOptions(database, session, {
      limit: queryInteger(request.query.limit, 100, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
    }));
  }));

  router.post("/", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const scope = bodyRecord(request).scope;
    if (scope !== "ORGANIZATION" && scope !== "COMPANY") throw new AuthServiceError(400, "INVALID_REQUEST", "El alcance no es válido.");
    const companyId = bodyRecord(request).companyId;
    if (companyId !== undefined && !isUuid(companyId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La empresa no es válida.");
    response.status(201).json(await createCatalog(database, session, {
      code: bodyText(request, "code", 80) as string,
      name: bodyText(request, "name", 160) as string,
      description: bodyOptionalText(request, "description", 500),
      scope,
      companyId: companyId as string | undefined,
      requestId: requestId(response),
    }));
  }));

  router.get("/:catalogId/items", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId)) throw new AuthServiceError(400, "INVALID_REQUEST", "El catálogo no es válido.");
    response.status(200).json(await listCatalogItems(database, session, {
      catalogId: request.params.catalogId,
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      search: querySearch(request.query.search),
      status: parseStatus(request.query.status),
    }));
  }));

  router.post("/:catalogId/items", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId)) throw new AuthServiceError(400, "INVALID_REQUEST", "El catálogo no es válido.");
    response.status(201).json(await createCatalogItem(database, session, {
      catalogId: request.params.catalogId,
      code: bodyText(request, "code", 80) as string,
      name: bodyText(request, "name", 160) as string,
      description: bodyOptionalText(request, "description", 500),
      requestId: requestId(response),
    }));
  }));

  router.patch("/:catalogId/items/:itemId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId) || !isUuid(request.params.itemId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La opción no es válida.");
    const status = parseStatus(bodyRecord(request).status);
    response.status(200).json(await updateCatalogItem(database, session, {
      catalogId: request.params.catalogId,
      itemId: request.params.itemId,
      code: bodyText(request, "code", 80, true),
      name: bodyText(request, "name", 160, true),
      description: bodyOptionalText(request, "description", 500),
      status,
      requestId: requestId(response),
    }));
  }));

  router.delete("/:catalogId/items/:itemId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId) || !isUuid(request.params.itemId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La opción no es válida.");
    await deactivateCatalogItem(database, session, { catalogId: request.params.catalogId, itemId: request.params.itemId, requestId: requestId(response) });
    response.status(204).end();
  }));

  router.patch("/:catalogId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId)) throw new AuthServiceError(400, "INVALID_REQUEST", "El catálogo no es válido.");
    response.status(200).json(await updateCatalog(database, session, {
      catalogId: request.params.catalogId,
      name: bodyText(request, "name", 160, true),
      description: bodyOptionalText(request, "description", 500),
      status: parseStatus(bodyRecord(request).status),
      requestId: requestId(response),
    }));
  }));

  router.delete("/:catalogId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.catalogId)) throw new AuthServiceError(400, "INVALID_REQUEST", "El catálogo no es válido.");
    await deactivateCatalog(database, session, { catalogId: request.params.catalogId, requestId: requestId(response) });
    response.status(204).end();
  }));

  return router;
}
