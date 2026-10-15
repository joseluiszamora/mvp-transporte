export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "API administrativa",
    version: "0.1.0",
    description: "API base para la plataforma administrativa independiente.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/v1/auth/login": {
      post: {
        summary: "Inicia una sesión global y selecciona una membresía activa cuando exista.",
        operationId: "login",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } } },
        responses: {
          "200": { description: "Sesión creada. El refresh se entrega en una cookie HttpOnly.", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthCredentials" } } } },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { description: "Credenciales no válidas." },
          "429": { $ref: "#/components/responses/ApiError" },
          "503": { $ref: "#/components/responses/ApiError" },
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        summary: "Rota el refresh token de la cookie y emite un access token en memoria.",
        operationId: "refreshSession",
        parameters: [{ in: "header", name: "X-CSRF-Token", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Sesión renovada." },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "429": { $ref: "#/components/responses/ApiError" },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        summary: "Revoca la sesión identificada por la cookie refresh.",
        operationId: "logout",
        parameters: [{ in: "header", name: "X-CSRF-Token", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Sesión revocada y cookies eliminadas." }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/me": {
      get: {
        summary: "Devuelve el perfil propio, membresías activas y permisos del tenant seleccionado.",
        operationId: "getCurrentUser",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Perfil autenticado." }, "401": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/select-organization": {
      post: {
        summary: "Selecciona una membresía activa dentro de la misma sesión global.",
        operationId: "selectOrganization",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SelectOrganizationRequest" } } } },
        responses: { "200": { description: "Nuevo access token para el tenant seleccionado." }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/recovery": {
      post: {
        summary: "Solicita recuperación sin revelar si el correo existe.",
        operationId: "requestPasswordRecovery",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmailRequest" } } } },
        responses: { "202": { description: "Respuesta genérica de aceptación." }, "429": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/recovery/complete": {
      post: {
        summary: "Cambia la contraseña y revoca las sesiones activas.",
        operationId: "completePasswordRecovery",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TokenPasswordRequest" } } } },
        responses: { "204": { description: "Contraseña actualizada." }, "400": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/activation/inspect": {
      post: {
        summary: "Consulta el propósito de un enlace de un solo uso sin consumirlo.",
        operationId: "inspectActivation",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TokenRequest" } } } },
        responses: { "200": { description: "Información segura del flujo de activación." }, "400": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/auth/activation/complete": {
      post: {
        summary: "Activa una cuenta o acepta una invitación de membresía.",
        operationId: "completeActivation",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ActivationRequest" } } } },
        responses: { "200": { description: "Enlace consumido y cuenta o membresía activada." }, "400": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/users": {
      get: {
        summary: "Lista membresías del tenant actual con paginación.",
        operationId: "listOrganizationUsers",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de membresías." }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/users/invitations": {
      post: {
        summary: "Invita un correo al tenant actual sin revelar si la identidad ya existe.",
        operationId: "inviteOrganizationUser",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InviteUserRequest" } } } },
        responses: { "202": { description: "Respuesta genérica de aceptación." }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/platform/organizations": {
      post: {
        summary: "Crea un tenant, su rol inicial de administrador y una invitación.",
        operationId: "createOrganization",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateOrganizationRequest" } } } },
        responses: { "201": { description: "Tenant creado." }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
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
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    responses: {
      ApiError: {
        description: "Error de API con identificador de solicitud.",
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
                    code: { type: "string" },
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
    schemas: {
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          password: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
      EmailRequest: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email", maxLength: 320 } },
      },
      TokenRequest: {
        type: "object",
        required: ["token"],
        properties: { token: { type: "string", minLength: 32, maxLength: 128 } },
      },
      TokenPasswordRequest: {
        type: "object",
        required: ["token", "password"],
        properties: {
          token: { type: "string", minLength: 32, maxLength: 128 },
          password: { type: "string", minLength: 12, maxLength: 1024 },
        },
      },
      ActivationRequest: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string", minLength: 32, maxLength: 128 },
          password: { type: "string", minLength: 12, maxLength: 1024 },
        },
      },
      SelectOrganizationRequest: {
        type: "object",
        required: ["organizationId"],
        properties: { organizationId: { type: "string", format: "uuid" } },
      },
      InviteUserRequest: {
        type: "object",
        required: ["email", "displayName"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          displayName: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
      CreateOrganizationRequest: {
        type: "object",
        required: ["organizationName", "adminEmail", "adminDisplayName"],
        properties: {
          organizationName: { type: "string", minLength: 1, maxLength: 160 },
          adminEmail: { type: "string", format: "email", maxLength: 320 },
          adminDisplayName: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
      AuthCredentials: {
        type: "object",
        required: ["accessToken", "accessTokenExpiresAt", "csrfToken", "user", "organizations", "selectedOrganizationId"],
        properties: {
          accessToken: { type: "string" },
          accessTokenExpiresAt: { type: "string", format: "date-time" },
          csrfToken: { type: "string" },
          user: { type: "object" },
          organizations: { type: "array", items: { type: "object" } },
          selectedOrganizationId: { type: ["string", "null"], format: "uuid" },
        },
      },
    },
  },
} as const;
