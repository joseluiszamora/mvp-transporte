import { createReadStream } from "node:fs";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import { resolveFileStorageRoot, removeStoredPath } from "./file-storage.ts";
import { receiveMultipartUpload } from "./multipart-upload.ts";
import {
  authorizeFileResource,
  getAuthorizedFileContent,
  getFileMetadata,
  listFileScopeOptions,
  listFiles,
  requestFileDeletion,
  storeUploadedFile,
  type FileResourceType,
} from "./files-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const resourceTypes = new Set<FileResourceType>(["COMPANY_ATTACHMENT", "BRANCH_ATTACHMENT", "EMPLOYEE_PHOTO", "EMPLOYEE_DOCUMENT"]);

function resourceType(value: unknown): FileResourceType {
  if (typeof value === "string" && resourceTypes.has(value as FileResourceType)) return value as FileResourceType;
  throw new AuthServiceError(400, "INVALID_FILE_RESOURCE", "El tipo de recurso no está permitido.");
}

function uuid(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function queryText(request: Request, key: string, required = false): string | undefined {
  const value = request.query[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 120 || /[\0\r\n]/u.test(value)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return value;
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

function requestId(response: Response): string {
  return (response.locals as AuthLocals).requestId;
}

function requireAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.get("origin");
  if (origin && !allowedOrigins.has(origin)) throw new AuthServiceError(403, "ORIGIN_REJECTED", "Origen de solicitud no permitido.");
}

function requireContext(database: Pool | undefined, response: Response) {
  const session = getAuthenticatedSession(response);
  if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return { database, session };
}

function contentDispositionName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function createFilesRouter(
  database: Pool | undefined,
  settings: AuthSettings,
  allowedOrigins: readonly string[],
  configuredStorageRoot?: string,
): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(database, settings);
  const origins = new Set(allowedOrigins);
  const storageRoot = resolveFileStorageRoot(configuredStorageRoot);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store, private"); next(); });

  router.get("/scope-options", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await listFileScopeOptions(db, session, {
      limit: queryInteger(request, "limit", 100, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"),
    }));
  }));

  router.get("/", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await listFiles(db, session, {
      resourceType: resourceType(queryText(request, "resourceType", true)),
      resourceId: uuid(queryText(request, "resourceId", true), "El recurso"),
      limit: queryInteger(request, "limit", 20, 1, 100),
      offset: queryInteger(request, "offset", 0, 0, 1_000_000),
      search: queryText(request, "search"),
    }));
  }));

  router.post("/", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    const type = resourceType(queryText(request, "resourceType", true));
    const id = uuid(queryText(request, "resourceId", true), "El recurso");
    if (type === "EMPLOYEE_DOCUMENT") throw new AuthServiceError(400, "EMPLOYEE_DOCUMENT_METADATA_REQUIRED", "Carga el documento desde el detalle del empleado e indica su tipo.");
    await authorizeFileResource(db, session, type, id, "write");
    const content = await receiveMultipartUpload(request, storageRoot);
    try {
      response.status(201).json(await storeUploadedFile(db, session, { storageRoot, resourceType: type, resourceId: id, content, requestId: requestId(response) }));
    } finally {
      await removeStoredPath(content.tempPath).catch(() => undefined);
    }
  }));

  router.get("/:fileId/content", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const fileId = uuid(request.params.fileId, "El archivo");
    const { item, path } = await getAuthorizedFileContent(db, session, fileId, storageRoot);
    const stream = createReadStream(path);
    await new Promise<void>((resolveStream, rejectStream) => {
      stream.once("open", () => {
        response.status(200);
        response.setHeader("Content-Type", item.detectedMime);
        response.setHeader("Content-Length", String(item.bytes));
        response.setHeader("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${contentDispositionName(item.originalName)}`);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        response.setHeader("Referrer-Policy", "no-referrer");
        stream.pipe(response);
        resolveStream();
      });
      stream.once("error", (error: NodeJS.ErrnoException) => {
        if (response.headersSent) response.destroy(error);
        else if (error.code === "ENOENT") rejectStream(new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible."));
        else rejectStream(error);
      });
      response.once("close", () => { if (!response.writableEnded) stream.destroy(); });
    });
  }));

  router.get("/:fileId", authenticate, asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await getFileMetadata(db, session, uuid(request.params.fileId, "El archivo")));
  }));

  router.delete("/:fileId", authenticate, asyncRoute(async (request, response) => {
    requireAllowedOrigin(request, origins);
    const { database: db, session } = requireContext(database, response);
    await requestFileDeletion(db, session, uuid(request.params.fileId, "El archivo"), requestId(response));
    response.status(204).end();
  }));

  return router;
}
