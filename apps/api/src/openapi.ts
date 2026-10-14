export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "API administrativa",
    version: "0.1.0",
    description: "API base para la plataforma administrativa independiente.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Comprueba que el proceso de API responde.",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "La API está activa.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "service", "timestamp"],
                  properties: {
                    status: { type: "string", const: "ok" },
                    service: { type: "string", const: "api" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/ready": {
      get: {
        summary: "Comprueba que la API puede usar su base de datos.",
        operationId: "getReadiness",
        responses: {
          "200": {
            description: "La API está lista.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string", const: "ready" } },
                },
              },
            },
          },
          "503": {
            description: "La dependencia de base de datos no está disponible.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["error"],
                  properties: {
                    error: {
                      type: "object",
                      required: ["code", "message", "requestId"],
                      properties: {
                        code: { type: "string", const: "SERVICE_NOT_READY" },
                        message: { type: "string" },
                        requestId: { type: "string", format: "uuid" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        summary: "Devuelve este documento OpenAPI.",
        operationId: "getOpenApiDocument",
        responses: { "200": { description: "Documento OpenAPI." } },
      },
    },
  },
} as const;
