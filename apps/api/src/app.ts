import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Express } from "express";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { Pool } from "pg";
import type { ApiErrorResponse, HealthResponse, ReadinessResponse } from "@mvp-transporte/contracts";
import { openApiDocument } from "./openapi.ts";
import { createAuthRouter } from "./modules/auth/auth-router.ts";
import type { AuthSettings } from "./modules/auth/auth-service.ts";

export interface AppDependencies {
  allowedOrigins?: readonly string[];
  checkDatabase?: () => Promise<void>;
  database?: Pool;
  authSettings?: AuthSettings;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const allowedOrigins = dependencies.allowedOrigins ?? [];
  const checkDatabase = dependencies.checkDatabase ?? (async () => undefined);
  const authSettings = dependencies.authSettings ?? { secureCookies: false };

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: [...allowedOrigins], credentials: true }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/v1/health", (_request, response) => {
    const body: HealthResponse = {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
    response.status(200).json(body);
  });

  app.get("/api/v1/ready", async (_request, response) => {
    try {
      await checkDatabase();
      const body: ReadinessResponse = { status: "ready" };
      response.status(200).json(body);
    } catch {
      response.status(503).json({
        error: {
          code: "SERVICE_NOT_READY",
          message: "Servicio temporalmente no disponible.",
          requestId: response.locals.requestId,
        },
      } satisfies ApiErrorResponse);
    }
  });

  app.get("/api/v1/openapi.json", (_request, response) => {
    response.status(200).json(openApiDocument);
  });

  app.use("/api/v1", createAuthRouter(dependencies.database, authSettings, allowedOrigins));

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Recurso no encontrado.",
        requestId: response.locals.requestId,
      },
    } satisfies ApiErrorResponse);
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const candidateStatus =
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : undefined;
    const isBadRequest = candidateStatus === 400;
    const body: ApiErrorResponse = {
      error: {
        code: isBadRequest ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        message: isBadRequest ? "La solicitud no es válida." : "Ocurrió un error interno.",
        requestId: response.locals.requestId,
      },
    };
    response.status(isBadRequest ? 400 : 500).json(body);
  };
  app.use(errorHandler);

  return app;
}
