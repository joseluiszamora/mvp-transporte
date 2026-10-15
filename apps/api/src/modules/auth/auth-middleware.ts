import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import type { ApiErrorResponse } from "@mvp-transporte/contracts";
import type { AuthSettings, AuthenticatedSession } from "./auth-service.ts";
import { AuthServiceError, authenticateAccessToken } from "./auth-service.ts";

export interface AuthLocals {
  requestId: string;
  auth?: AuthenticatedSession;
}

export function sendAuthError(response: Response, error: unknown): void {
  const serviceError = error instanceof AuthServiceError ? error : undefined;
  const status = serviceError?.status ?? 500;
  if (serviceError?.retryAfterSeconds) {
    response.setHeader("Retry-After", String(serviceError.retryAfterSeconds));
  }
  response.status(status).json({
    error: {
      code: serviceError?.code ?? "INTERNAL_ERROR",
      message: serviceError?.publicMessage ?? "Ocurrió un error interno.",
      requestId: (response.locals as AuthLocals).requestId,
    },
  } satisfies ApiErrorResponse);
}

export function createAuthenticationMiddleware(
  database: Pool | undefined,
  settings: AuthSettings,
) {
  return async function authenticate(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const authorization = request.get("authorization");
      const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/u);
      if (!match) {
        response.status(401).json({
          error: {
            code: "UNAUTHENTICATED",
            message: "Inicia sesión para continuar.",
            requestId: (response.locals as AuthLocals).requestId,
          },
        } satisfies ApiErrorResponse);
        return;
      }
      const auth = await authenticateAccessToken(database, settings, match[1]);
      if (!auth) {
        response.status(401).json({
          error: {
            code: "UNAUTHENTICATED",
            message: "La sesión ya no está disponible.",
            requestId: (response.locals as AuthLocals).requestId,
          },
        } satisfies ApiErrorResponse);
        return;
      }
      (response.locals as AuthLocals).auth = auth;
      next();
    } catch (error) {
      sendAuthError(response, error);
    }
  };
}

export function requireSelectedOrganization(requestId: string, response: Response): AuthenticatedSession | null {
  const auth = (response.locals as AuthLocals).auth;
  if (!auth?.selectedMembershipId || !auth.organizationId) {
    response.status(403).json({
      error: {
        code: "ORGANIZATION_REQUIRED",
        message: "Selecciona una organización activa para continuar.",
        requestId,
      },
    } satisfies ApiErrorResponse);
    return null;
  }
  return auth;
}

export function getAuthenticatedSession(response: Response): AuthenticatedSession | null {
  return (response.locals as AuthLocals).auth ?? null;
}
