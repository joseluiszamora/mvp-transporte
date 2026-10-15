import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createOrganizationWithAdmin } from "../organizations/platform-service.ts";
import { listPlatformOrganizations, updatePlatformOrganization } from "../organizations/organization-management-service.ts";
import {
  createTenantBranch,
  createTenantCompany,
  listTenantBranches,
  listTenantCompanies,
  updateTenantBranch,
  updateTenantCompany,
} from "../organizations/tenant-organization-service.ts";
import { inviteOrganizationUser, listOrganizationUsers, updateOrganizationMembershipStatus } from "../users/tenant-users-service.ts";
import { consumeRateLimit } from "./rate-limit.ts";
import {
  AuthServiceError,
  authenticateAccessToken,
  completeAccountActivation,
  completePasswordRecovery,
  getCurrentUser,
  inspectAccountToken,
  login,
  logout,
  requestPasswordRecovery,
  rotateRefreshToken,
  selectOrganization,
  validateCsrfPair,
  requireEmailAddress,
  type AuthSettings,
} from "./auth-service.ts";
import {
  type AuthLocals,
  createAuthenticationMiddleware,
  getAuthenticatedSession,
  sendAuthError,
} from "./auth-middleware.ts";
import { hashOpaqueToken } from "./auth-crypto.ts";
import {
  createOrganizationRole,
  createRoleAssignment,
  deleteRoleAssignment,
  listOrganizationRoleAssignments,
  listOrganizationRoles,
  listPermissionCatalog,
  listRoleAssignmentOptions,
  parseRoleOptionKind,
  parseRoleStatus,
  updateOrganizationRole,
} from "../access/role-management-service.ts";

const refreshCookieName = "mvp_refresh";
const csrfCookieName = "mvp_csrf";
const authCookiePath = "/api/v1/auth";
const rateLimitWindowMs = 15 * 60 * 1_000;
const recoveryResponse = {
  message: "Si la cuenta está activa, recibirá un mensaje con los siguientes pasos.",
};
const invitationResponse = {
  message: "Si la invitación puede procesarse, recibirá un correo con los siguientes pasos.",
};

function bodyRecord(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
    ? (request.body as Record<string, unknown>)
    : {};
}

function bodyText(request: Request, key: string, maximumLength = 4_000, optional = false): string | undefined {
  const value = bodyRecord(request)[key];
  if (value === undefined && optional) {
    return undefined;
  }
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

function parseRecordStatus(value: unknown): "ACTIVE" | "INACTIVE" | undefined {
  if (value === undefined) return undefined;
  if (value === "ACTIVE" || value === "INACTIVE") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "El estado no es válido.");
}

function parseOrganizationStatus(value: unknown): "ACTIVE" | "SUSPENDED" | undefined {
  if (value === undefined) return undefined;
  if (value === "ACTIVE" || value === "SUSPENDED") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "El estado no es válido.");
}

function querySearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  return value;
}

function sendError(response: Response, error: unknown): void {
  sendAuthError(response, error);
}

function asyncRoute(
  action: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response, next).catch((error: unknown) => {
      if (!response.headersSent) {
        sendError(response, error);
      } else {
        next(error);
      }
    });
  };
}

function getRequestId(response: Response): string {
  return (response.locals as AuthLocals).requestId;
}

function parseCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function writeSessionCookies(response: Response, settings: AuthSettings, refreshToken: string, csrfToken: string): void {
  const secure = settings.secureCookies ? "; Secure" : "";
  response.setHeader("Set-Cookie", [
    `${refreshCookieName}=${refreshToken}; HttpOnly; Path=${authCookiePath}; SameSite=Lax${secure}; Max-Age=${7 * 24 * 60 * 60}`,
    `${csrfCookieName}=${csrfToken}; Path=/; SameSite=Lax${secure}; Max-Age=${7 * 24 * 60 * 60}`,
  ]);
  response.setHeader("Cache-Control", "no-store");
}

function clearSessionCookies(response: Response, settings: AuthSettings): void {
  const secure = settings.secureCookies ? "; Secure" : "";
  response.setHeader("Set-Cookie", [
    `${refreshCookieName}=; HttpOnly; Path=${authCookiePath}; SameSite=Lax${secure}; Max-Age=0`,
    `${csrfCookieName}=; Path=/; SameSite=Lax${secure}; Max-Age=0`,
  ]);
  response.setHeader("Cache-Control", "no-store");
}

function requireAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>, required: boolean): void {
  const origin = request.get("origin");
  if ((!origin && required) || (origin && !allowedOrigins.has(origin))) {
    throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
  }
}

function clientAddress(request: Request): string {
  return request.socket.remoteAddress ?? "unknown";
}

async function applyRateLimit(
  database: Pool | undefined,
  request: Request,
  input: { operation: string; identity: string; maximumAttempts: number; windowMs?: number },
): Promise<void> {
  if (!database) {
    throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  }
  const retryAfterSeconds = await consumeRateLimit({
    database,
    operation: input.operation,
    identity: input.identity,
    clientAddress: clientAddress(request),
    maximumAttempts: input.maximumAttempts,
    windowMs: input.windowMs ?? rateLimitWindowMs,
  });
  if (retryAfterSeconds) {
    throw new AuthServiceError(429, "TOO_MANY_REQUESTS", "Espera antes de volver a intentarlo.", retryAfterSeconds);
  }
}

function queryInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const text = typeof value === "string" ? value : String(fallback);
  if (!/^\d{1,9}$/u.test(text)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return parsed;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function bodyUuid(request: Request, key: string, optional = false): string | undefined {
  const value = bodyRecord(request)[key];
  if (value === undefined && optional) return undefined;
  if (!isUuid(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  return value;
}

function bodyPermissionCodes(request: Request, optional = false): string[] | undefined {
  const value = bodyRecord(request).permissionCodes;
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 100)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return value as string[];
}

export function createAuthRouter(
  database: Pool | undefined,
  settings: AuthSettings,
  allowedOrigins: readonly string[],
): Router {
  const router = Router();
  const origins = new Set(allowedOrigins);
  const authenticate = createAuthenticationMiddleware(database, settings);
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/auth/login", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const email = bodyText(request, "email", 320) as string;
    const password = bodyText(request, "password", 1_024) as string;
    const normalizedEmail = requireEmailAddress(email);
    await applyRateLimit(database, request, {
      operation: "login",
      identity: normalizedEmail,
      maximumAttempts: 10,
    });
    const credentials = await login(database, settings, {
      email: normalizedEmail,
      password,
      requestId: getRequestId(response),
    });
    writeSessionCookies(response, settings, credentials.refreshToken, credentials.csrfToken);
    const { refreshToken: _refreshToken, ...publicCredentials } = credentials;
    response.status(200).json(publicCredentials);
  }));

  router.post("/auth/refresh", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const refreshToken = parseCookie(request, refreshCookieName);
    const csrfToken = parseCookie(request, csrfCookieName);
    if (!validateCsrfPair(csrfToken, request.get("x-csrf-token"))) {
      throw new AuthServiceError(403, "CSRF_REJECTED", "La solicitud no pudo validarse.");
    }
    await applyRateLimit(database, request, {
      operation: "refresh",
      identity: refreshToken ? hashOpaqueToken(refreshToken) : "missing",
      maximumAttempts: 40,
    });
    const credentials = await rotateRefreshToken(database, settings, refreshToken, getRequestId(response));
    writeSessionCookies(response, settings, credentials.refreshToken, credentials.csrfToken);
    const { refreshToken: _refreshToken, ...publicCredentials } = credentials;
    response.status(200).json(publicCredentials);
  }));

  router.post("/auth/logout", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const csrfToken = parseCookie(request, csrfCookieName);
    if (!validateCsrfPair(csrfToken, request.get("x-csrf-token"))) {
      throw new AuthServiceError(403, "CSRF_REJECTED", "La solicitud no pudo validarse.");
    }
    const authorization = request.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]+)$/u);
    const currentSession = database && authorization
      ? await authenticateAccessToken(database, settings, authorization[1]).catch(() => null)
      : null;
    await logout(database, parseCookie(request, refreshCookieName), getRequestId(response), currentSession);
    clearSessionCookies(response, settings);
    response.status(204).end();
  }));

  router.get("/auth/me", authenticate, asyncRoute(async (_request, response) => {
    const session = getAuthenticatedSession(response);
    if (!session || !database) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    response.status(200).json(await getCurrentUser(database, session));
  }));

  router.post("/auth/select-organization", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!session) {
      throw new AuthServiceError(401, "UNAUTHENTICATED", "La sesión ya no está disponible.");
    }
    const organizationId = bodyText(request, "organizationId", 36) as string;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(organizationId)) {
      throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    if (!database) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    response.status(200).json(await selectOrganization(database, settings, session, organizationId, getRequestId(response)));
  }));

  router.post("/auth/recovery", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const email = requireEmailAddress(bodyText(request, "email", 320) as string);
    await applyRateLimit(database, request, { operation: "recovery", identity: email, maximumAttempts: 5, windowMs: 30 * 60 * 1_000 });
    await requestPasswordRecovery(database, settings, { email, requestId: getRequestId(response) });
    response.status(202).json(recoveryResponse);
  }));

  router.post("/auth/recovery/complete", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const token = bodyText(request, "token", 128) as string;
    const password = bodyText(request, "password", 1_024) as string;
    await applyRateLimit(database, request, {
      operation: "recovery-complete",
      identity: hashOpaqueToken(token),
      maximumAttempts: 5,
      windowMs: 30 * 60 * 1_000,
    });
    await completePasswordRecovery(database, settings, { token, password, requestId: getRequestId(response) });
    response.status(204).end();
  }));

  router.post("/auth/activation/inspect", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const token = bodyText(request, "token", 128) as string;
    await applyRateLimit(database, request, {
      operation: "activation-inspect",
      identity: hashOpaqueToken(token),
      maximumAttempts: 10,
      windowMs: 60 * 60 * 1_000,
    });
    response.status(200).json(await inspectAccountToken(database, token));
  }));

  router.post("/auth/activation/complete", asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, true);
    const token = bodyText(request, "token", 128) as string;
    const password = bodyText(request, "password", 1_024, true);
    await applyRateLimit(database, request, {
      operation: "activation-complete",
      identity: hashOpaqueToken(token),
      maximumAttempts: 5,
      windowMs: 60 * 60 * 1_000,
    });
    response.status(200).json(await completeAccountActivation(database, { token, password, requestId: getRequestId(response) }));
  }));

  router.get("/organizations/users", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    const limit = queryInteger(request.query.limit, 20, 1, 100);
    const offset = queryInteger(request.query.offset, 0, 0, 1_000_000);
    response.status(200).json(await listOrganizationUsers(database, session, { limit, offset }));
  }));

  router.post("/organizations/users/invitations", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    await inviteOrganizationUser(database, settings, session, {
      email: bodyText(request, "email", 320) as string,
      displayName: bodyText(request, "displayName", 160) as string,
      requestId: getRequestId(response),
    });
    response.status(202).json(invitationResponse);
  }));

  router.patch("/organizations/users/:membershipId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.membershipId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const status = bodyRecord(request).status;
    if (status !== "ACTIVE" && status !== "SUSPENDED") throw new AuthServiceError(400, "INVALID_REQUEST", "El estado no es válido.");
    response.status(200).json(await updateOrganizationMembershipStatus(database, session, {
      membershipId: request.params.membershipId,
      status,
      requestId: getRequestId(response),
    }));
  }));

  router.get("/organizations/companies", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listTenantCompanies(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      search: querySearch(request.query.search),
      status: parseRecordStatus(request.query.status),
    }));
  }));

  router.post("/organizations/companies", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(201).json(await createTenantCompany(database, session, {
      legalName: bodyText(request, "legalName", 200) as string,
      tradeName: bodyOptionalText(request, "tradeName", 200),
      nit: bodyOptionalText(request, "nit", 40),
      contact: bodyOptionalText(request, "contact", 300),
      address: bodyOptionalText(request, "address", 500),
      requestId: getRequestId(response),
    }));
  }));

  router.patch("/organizations/companies/:companyId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.companyId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    response.status(200).json(await updateTenantCompany(database, session, {
      companyId: request.params.companyId,
      legalName: bodyText(request, "legalName", 200, true),
      tradeName: bodyOptionalText(request, "tradeName", 200),
      nit: bodyOptionalText(request, "nit", 40),
      contact: bodyOptionalText(request, "contact", 300),
      address: bodyOptionalText(request, "address", 500),
      status: parseRecordStatus(bodyRecord(request).status),
      requestId: getRequestId(response),
    }));
  }));

  router.delete("/organizations/companies/:companyId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.companyId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    await updateTenantCompany(database, session, { companyId: request.params.companyId, status: "INACTIVE", requestId: getRequestId(response) });
    response.status(204).end();
  }));

  router.get("/organizations/branches", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const companyId = request.query.companyId;
    if (companyId !== undefined && (typeof companyId !== "string" || !isUuid(companyId))) throw new AuthServiceError(400, "INVALID_REQUEST", "La empresa no es válida.");
    response.status(200).json(await listTenantBranches(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      companyId: typeof companyId === "string" ? companyId : undefined,
      search: querySearch(request.query.search),
      status: parseRecordStatus(request.query.status),
    }));
  }));

  router.post("/organizations/companies/:companyId/branches", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.companyId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La empresa no es válida.");
    response.status(201).json(await createTenantBranch(database, session, {
      companyId: request.params.companyId,
      code: bodyText(request, "code", 40) as string,
      name: bodyText(request, "name", 160) as string,
      address: bodyOptionalText(request, "address", 500),
      contact: bodyOptionalText(request, "contact", 300),
      requestId: getRequestId(response),
    }));
  }));

  router.patch("/organizations/branches/:branchId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.branchId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La sucursal no es válida.");
    response.status(200).json(await updateTenantBranch(database, session, {
      branchId: request.params.branchId,
      code: bodyText(request, "code", 40, true),
      name: bodyText(request, "name", 160, true),
      address: bodyOptionalText(request, "address", 500),
      contact: bodyOptionalText(request, "contact", 300),
      status: parseRecordStatus(bodyRecord(request).status),
      requestId: getRequestId(response),
    }));
  }));

  router.delete("/organizations/branches/:branchId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.branchId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La sucursal no es válida.");
    await updateTenantBranch(database, session, { branchId: request.params.branchId, status: "INACTIVE", requestId: getRequestId(response) });
    response.status(204).end();
  }));

  router.get("/organizations/roles/permissions", authenticate, asyncRoute(async (_request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listPermissionCatalog(database, session));
  }));

  router.get("/organizations/roles", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listOrganizationRoles(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
    }));
  }));

  router.post("/organizations/roles", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const role = await createOrganizationRole(database, session, {
      name: bodyText(request, "name", 120) as string,
      permissionCodes: bodyPermissionCodes(request) as string[],
      requestId: getRequestId(response),
    });
    response.status(201).json(role);
  }));

  router.patch("/organizations/roles/:roleId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.roleId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const body = bodyRecord(request);
    const rawStatus = body.status;
    if (rawStatus !== undefined && rawStatus !== "ACTIVE" && rawStatus !== "INACTIVE") {
      throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    const role = await updateOrganizationRole(database, session, {
      roleId: request.params.roleId,
      name: bodyText(request, "name", 120, true),
      status: rawStatus === undefined ? undefined : parseRoleStatus(rawStatus),
      permissionCodes: bodyPermissionCodes(request, true),
      requestId: getRequestId(response),
    });
    response.status(200).json(role);
  }));

  router.get("/organizations/role-assignments", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listOrganizationRoleAssignments(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
    }));
  }));

  router.get("/organizations/role-assignment-options", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const kind = parseRoleOptionKind(typeof request.query.kind === "string" ? request.query.kind : undefined);
    const companyId = request.query.companyId;
    if (companyId !== undefined && !isUuid(companyId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    response.status(200).json(await listRoleAssignmentOptions(database, session, {
      kind,
      limit: queryInteger(request.query.limit, 100, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      companyId: typeof companyId === "string" ? companyId : undefined,
    }));
  }));

  router.post("/organizations/role-assignments", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const body = bodyRecord(request);
    const scopeType = body.scopeType;
    if (scopeType !== "ORGANIZATION" && scopeType !== "COMPANY" && scopeType !== "BRANCH") {
      throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    const assignment = await createRoleAssignment(database, session, {
      membershipId: bodyUuid(request, "membershipId") as string,
      roleId: bodyUuid(request, "roleId") as string,
      scopeType,
      companyId: bodyUuid(request, "companyId", true),
      branchId: bodyUuid(request, "branchId", true),
      requestId: getRequestId(response),
    });
    response.status(201).json(assignment);
  }));

  router.delete("/organizations/role-assignments/:assignmentId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.assignmentId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    await deleteRoleAssignment(database, session, { assignmentId: request.params.assignmentId, requestId: getRequestId(response) });
    response.status(204).end();
  }));

  router.get("/platform/organizations", authenticate, asyncRoute(async (request, response) => {
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    response.status(200).json(await listPlatformOrganizations(database, session, {
      limit: queryInteger(request.query.limit, 20, 1, 100),
      offset: queryInteger(request.query.offset, 0, 0, 1_000_000),
      search: querySearch(request.query.search),
      status: parseOrganizationStatus(request.query.status),
    }));
  }));

  router.post("/platform/organizations", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) {
      throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    }
    const organization = await createOrganizationWithAdmin(database, settings, session, {
      organizationName: bodyText(request, "organizationName", 160) as string,
      adminEmail: bodyText(request, "adminEmail", 320) as string,
      adminDisplayName: bodyText(request, "adminDisplayName", 160) as string,
      requestId: getRequestId(response),
    });
    response.status(201).json(organization);
  }));

  router.patch("/platform/organizations/:organizationId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins, false);
    const session = getAuthenticatedSession(response);
    if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    if (!isUuid(request.params.organizationId)) throw new AuthServiceError(400, "INVALID_REQUEST", "La organización no es válida.");
    response.status(200).json(await updatePlatformOrganization(database, session, {
      organizationId: request.params.organizationId,
      name: bodyText(request, "name", 160, true),
      status: parseOrganizationStatus(bodyRecord(request).status),
      requestId: getRequestId(response),
    }));
  }));

  return router;
}
