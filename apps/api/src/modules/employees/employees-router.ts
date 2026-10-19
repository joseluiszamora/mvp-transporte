import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import { authorizeFileResource, storeUploadedFile } from "../files/files-service.ts";
import { resolveFileStorageRoot, removeStoredPath } from "../files/file-storage.ts";
import { receiveMultipartUpload } from "../files/multipart-upload.ts";
import { createEmployee, getEmployee, listEmployeeDocuments, listEmployeeScopeOptions, listEmployees, updateEmployee, type EmployeeMutationInput } from "./employees-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const allowedFields = new Set(["companyId", "internalCode", "firstNames", "lastNames", "personalDocumentNumber", "personalPhone", "personalEmail", "personalAddress", "positionId", "hireDate", "status", "userId", "branchIds"]);

function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function uuid(value: unknown, label: string): string { if (isUuid(value)) return value; throw new AuthServiceError(400, "INVALID_REQUEST", `${label} no es válido.`); }

function bodyRecord(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
}

function parseMutation(request: Request): EmployeeMutationInput {
  const body = bodyRecord(request);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La solicitud contiene campos no permitidos.");
  const output: EmployeeMutationInput = {};
  const strings = ["companyId", "internalCode", "firstNames", "lastNames", "personalDocumentNumber", "personalPhone", "personalEmail", "personalAddress", "hireDate"] as const;
  for (const key of strings) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La solicitud no es válida.");
    output[key] = value as never;
  }
  for (const key of ["positionId", "userId"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && !isUuid(value)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La solicitud no es válida.");
    output[key] = value as string | null;
  }
  if (body.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "INACTIVE") throw new AuthServiceError(400, "INVALID_EMPLOYEE", "El estado no es válido.");
    output.status = body.status;
  }
  if (body.branchIds !== undefined) {
    if (!Array.isArray(body.branchIds) || body.branchIds.some((id) => !isUuid(id))) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La lista de sucursales no es válida.");
    output.branchIds = body.branchIds as string[];
  }
  return output;
}

function queryText(request: Request, key: string, required = false): string | undefined {
  const value = request.query[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 120 || /[\0\r\n]/u.test(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  return value;
}

function queryUuid(request: Request, key: string): string | undefined {
  const value = request.query[key];
  if (value === undefined) return undefined;
  return uuid(value, "El alcance");
}

function queryInteger(request: Request, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = request.query[key]; const value = typeof raw === "string" ? raw : String(fallback);
  if (!/^\d{1,9}$/u.test(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch((error: unknown) => { if (response.headersSent) next(error); else sendAuthError(response, error); });
  };
}

function requestId(response: Response): string { return (response.locals as AuthLocals).requestId; }
function requireContext(database: Pool | undefined, response: Response) {
  const session = getAuthenticatedSession(response);
  if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return { database, session };
}
function requireAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.get("origin");
  if (origin && !allowedOrigins.has(origin)) throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
}

function parseDocumentDate(value: string | undefined, label: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new AuthServiceError(400, "INVALID_EMPLOYEE_DOCUMENT", `${label} no es válida.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AuthServiceError(400, "INVALID_EMPLOYEE_DOCUMENT", `${label} no es válida.`);
  return value;
}

export function createEmployeesRouter(database: Pool | undefined, settings: AuthSettings, allowedOrigins: readonly string[], configuredStorageRoot?: string): Router {
  const router = Router(); const authenticate = createAuthenticationMiddleware(database, settings); const origins = new Set(allowedOrigins);
  const storageRoot = resolveFileStorageRoot(configuredStorageRoot);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store, private"); next(); });

  router.get("/scope-options", authenticate, asyncRoute(async (_request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await listEmployeeScopeOptions(db, session));
  }));

  router.get("/", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const status = queryText(request, "status");
    if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE") throw new AuthServiceError(400, "INVALID_REQUEST", "El estado no es válido.");
    response.status(200).json(await listEmployees(db, session, {
      limit: queryInteger(request, "limit", 20, 1, 100), offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"), status, companyId: queryUuid(request, "companyId"), branchId: queryUuid(request, "branchId"),
    }));
  }));

  router.post("/", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    response.status(201).json(await createEmployee(db, session, parseMutation(request), requestId(response)));
  }));

  router.get("/:employeeId/documents", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await listEmployeeDocuments(db, session, uuid(request.params.employeeId, "El empleado")));
  }));

  router.post("/:employeeId/documents", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    const employeeId = uuid(request.params.employeeId, "El empleado");
    await authorizeFileResource(db, session, "EMPLOYEE_DOCUMENT", employeeId, "write");
    const content = await receiveMultipartUpload(request, storageRoot, { allowedFields: ["typeId", "issuedAt", "expiresAt"] });
    try {
      const typeId = uuid(content.fields.typeId, "El tipo de documento");
      const issuedAt = parseDocumentDate(content.fields.issuedAt, "La fecha de emisión");
      const expiresAt = parseDocumentDate(content.fields.expiresAt, "La fecha de vencimiento");
      if (issuedAt && expiresAt && expiresAt < issuedAt) throw new AuthServiceError(400, "INVALID_EMPLOYEE_DOCUMENT", "El vencimiento no puede ser anterior a la emisión.");
      response.status(201).json(await storeUploadedFile(db, session, {
        storageRoot, resourceType: "EMPLOYEE_DOCUMENT", resourceId: employeeId, content, requestId: requestId(response),
        document: { typeId, issuedAt, expiresAt },
      }));
    } finally { await removeStoredPath(content.tempPath).catch(() => undefined); }
  }));

  router.post("/:employeeId/photo", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    const employeeId = uuid(request.params.employeeId, "El empleado");
    await authorizeFileResource(db, session, "EMPLOYEE_PHOTO", employeeId, "write");
    const content = await receiveMultipartUpload(request, storageRoot);
    try {
      response.status(201).json(await storeUploadedFile(db, session, { storageRoot, resourceType: "EMPLOYEE_PHOTO", resourceId: employeeId, content, requestId: requestId(response) }));
    } finally { await removeStoredPath(content.tempPath).catch(() => undefined); }
  }));

  router.get("/:employeeId", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await getEmployee(db, session, uuid(request.params.employeeId, "El empleado")));
  }));

  router.patch("/:employeeId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await updateEmployee(db, session, uuid(request.params.employeeId, "El empleado"), parseMutation(request), requestId(response)));
  }));

  return router;
}
