import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, requireEmailAddress, type AuthSettings } from "../auth/auth-service.ts";
import { getInstallationSmtpSettings, getNotificationAccess, listEmailDeliveries, listEmailTemplates, saveInstallationSmtpSettings, sendAuthorizedSmtpTest } from "../email/smtp-settings-service.ts";

const allowedSettingsKeys = new Set(["host", "port", "secure", "requireTls", "fromAddress", "username", "password", "clearPassword"]);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

function bodyRecord(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
}

function invalid(): never { throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida."); }

function requiredString(body: Record<string, unknown>, key: string, maximum: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\r\n\0]/u.test(value)) return invalid();
  return value.trim();
}

function queryString(request: Request, key: string, maximum: number): string | undefined {
  const value = request.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum || /[\r\n\0]/u.test(value)) return invalid();
  return value.trim() || undefined;
}

function queryInteger(request: Request, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = request.query[key];
  const raw = typeof value === "string" ? value : String(fallback);
  if (!/^\d{1,9}$/u.test(raw)) return invalid();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return invalid();
  return parsed;
}

function queryInstant(request: Request, key: string): Date | undefined {
  const raw = queryString(request, key, 40);
  if (!raw) return undefined;
  if (!instantPattern.test(raw)) return invalid();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || new Date(`${raw.slice(0, 10)}T00:00:00.000Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) return invalid();
  return date;
}

function requestId(response: Response): string { return (response.locals as AuthLocals).requestId; }

function requireAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.get("origin");
  if (!origin || !allowedOrigins.has(origin)) throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
}

function requireSession(response: Response) {
  const session = getAuthenticatedSession(response);
  if (!session) throw new AuthServiceError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return session;
}

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch((error: unknown) => {
      if (response.headersSent) next(error);
      else sendAuthError(response, error);
    });
  };
}

export function createNotificationsRouter(database: Pool | undefined, settings: AuthSettings, allowedOrigins: readonly string[]): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(database, settings);
  const origins = new Set(allowedOrigins);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store, private"); next(); });

  router.get("/access", authenticate, asyncRoute(async (_request, response) => {
    response.status(200).json(await getNotificationAccess(database, requireSession(response)));
  }));

  router.get("/smtp", authenticate, asyncRoute(async (_request, response) => {
    response.status(200).json(await getInstallationSmtpSettings(database, requireSession(response)));
  }));

  router.put("/smtp", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const body = bodyRecord(request);
    if (Object.keys(body).some((key) => !allowedSettingsKeys.has(key))) return invalid();
    if (typeof body.port !== "number" || !Number.isInteger(body.port) || typeof body.secure !== "boolean" || typeof body.requireTls !== "boolean") return invalid();
    if (body.username !== undefined && body.username !== null && typeof body.username !== "string") return invalid();
    if (body.password !== undefined && (typeof body.password !== "string" || body.password.length > 1_024 || /[\0]/u.test(body.password))) return invalid();
    if (body.clearPassword !== undefined && typeof body.clearPassword !== "boolean") return invalid();
    const username = typeof body.username === "string" ? body.username.trim() || null : null;
    const password = typeof body.password === "string" && body.password.length > 0 ? body.password : undefined;
    const result = await saveInstallationSmtpSettings(database, requireSession(response), settings, {
      host: requiredString(body, "host", 255), port: body.port, secure: body.secure, requireTls: body.requireTls,
      fromAddress: requiredString(body, "fromAddress", 320), username, password,
      clearPassword: body.clearPassword === true,
    }, requestId(response));
    response.status(200).json(result);
  }));

  router.post("/smtp/test", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const body = bodyRecord(request);
    if (Object.keys(body).some((key) => key !== "recipient")) return invalid();
    const recipient = requireEmailAddress(requiredString(body, "recipient", 320));
    response.status(200).json(await sendAuthorizedSmtpTest(database, requireSession(response), settings, recipient, requestId(response)));
  }));

  router.get("/templates", authenticate, asyncRoute(async (_request, response) => {
    response.status(200).json(await listEmailTemplates(database, requireSession(response)));
  }));

  router.get("/deliveries", authenticate, asyncRoute(async (request, response) => {
    const outcome = queryString(request, "outcome", 10);
    if (outcome !== undefined && outcome !== "SENT" && outcome !== "FAILED") return invalid();
    const from = queryInstant(request, "from");
    const to = queryInstant(request, "to");
    if (from && to && from > to) return invalid();
    const templateCode = queryString(request, "templateCode", 100);
    if (templateCode && !/^[a-z0-9._-]+$/iu.test(templateCode)) return invalid();
    response.status(200).json(await listEmailDeliveries(database, requireSession(response), {
      limit: queryInteger(request, "limit", 20, 1, 100), offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      outcome, templateCode, from, to,
    }));
  }));
  return router;
}
