import type { ErrorRequestHandler } from "express";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createErrorHandler(): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    if (response.headersSent) return;
    const requestId = String(response.locals.requestId ?? "");
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message, requestId } });
      return;
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      response.status(409).json({ error: { code: "RESOURCE_CONFLICT", message: "El recurso ya existe en esta empresa.", requestId } });
      return;
    }
    process.stderr.write(`Unhandled API error (${requestId})\n`);
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "No fue posible completar la solicitud.", requestId } });
  };
}
