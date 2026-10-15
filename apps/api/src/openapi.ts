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
    "/api/v1/organizations/users/{membershipId}": {
      patch: {
        summary: "Suspende o reactiva una membresía del tenant sin modificar la cuenta global.",
        operationId: "updateOrganizationMembershipStatus",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "membershipId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MembershipStatusMutation" } } } },
        responses: { "200": { description: "Estado de membresía actualizado." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/companies": {
      get: {
        summary: "Lista empresas accesibles dentro del tenant seleccionado.",
        operationId: "listTenantCompanies",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 160 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
        ],
        responses: { "200": { description: "Página de empresas.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfCompanies" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea una empresa dentro del tenant seleccionado.",
        operationId: "createTenantCompany",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyMutation" } } } },
        responses: { "201": { description: "Empresa creada.", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/companies/{companyId}": {
      patch: {
        summary: "Actualiza datos o estado de una empresa propia del tenant.",
        operationId: "updateTenantCompany",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "companyId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyUpdate" } } } },
        responses: { "200": { description: "Empresa actualizada.", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
      delete: {
        summary: "Desactiva una empresa y conserva su historial.",
        operationId: "deactivateTenantCompany",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "companyId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "Empresa desactivada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/branches": {
      get: {
        summary: "Lista sucursales accesibles del tenant, opcionalmente dentro de una empresa.",
        operationId: "listTenantBranches",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 160 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
        ],
        responses: { "200": { description: "Página de sucursales.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfBranches" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/companies/{companyId}/branches": {
      post: {
        summary: "Crea una sucursal de una empresa propia y activa.",
        operationId: "createTenantBranch",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "companyId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BranchMutation" } } } },
        responses: { "201": { description: "Sucursal creada.", content: { "application/json": { schema: { $ref: "#/components/schemas/Branch" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/branches/{branchId}": {
      patch: {
        summary: "Actualiza datos o estado de una sucursal propia del tenant.",
        operationId: "updateTenantBranch",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "branchId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BranchUpdate" } } } },
        responses: { "200": { description: "Sucursal actualizada.", content: { "application/json": { schema: { $ref: "#/components/schemas/Branch" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
      delete: {
        summary: "Desactiva una sucursal y conserva su historial.",
        operationId: "deactivateTenantBranch",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "branchId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "Sucursal desactivada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/roles/permissions": {
      get: {
        summary: "Lista los permisos editables disponibles para roles del tenant actual.",
        operationId: "listRolePermissionCatalog",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Catálogo sin permisos de plataforma.", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/PermissionCatalogItem" } } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/roles": {
      get: {
        summary: "Lista roles del tenant con permisos y paginación.",
        operationId: "listOrganizationRoles",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de roles.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfRoles" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea un rol personalizado sin conceder permisos ajenos al actor.",
        operationId: "createOrganizationRole",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRoleRequest" } } } },
        responses: { "201": { description: "Rol creado.", content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationRoleMutationResult" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/roles/{roleId}": {
      patch: {
        summary: "Actualiza nombre, estado o permisos de un rol del tenant.",
        operationId: "updateOrganizationRole",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "roleId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateRoleRequest" } } } },
        responses: { "200": { description: "Rol actualizado.", content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationRoleMutationResult" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/role-assignments": {
      get: {
        summary: "Lista asignaciones de roles del tenant con alcance y paginación.",
        operationId: "listOrganizationRoleAssignments",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de asignaciones.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfRoleAssignments" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Asigna un rol a una membresía dentro del alcance autorizado del actor.",
        operationId: "createOrganizationRoleAssignment",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RoleAssignmentMutation" } } } },
        responses: { "201": { description: "Asignación creada.", content: { "application/json": { schema: { $ref: "#/components/schemas/RoleAssignmentCreated" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/role-assignments/{assignmentId}": {
      delete: {
        summary: "Retira una asignación sin dejar al tenant sin administrador activo.",
        operationId: "deleteOrganizationRoleAssignment",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "assignmentId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "Asignación retirada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/organizations/role-assignment-options": {
      get: {
        summary: "Lista membresías, empresas o sucursales activas del tenant para formular asignaciones.",
        operationId: "listRoleAssignmentOptions",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "kind", required: true, schema: { type: "string", enum: ["memberships", "companies", "branches"] } },
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Opciones activas del tenant.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfRoleAssignmentOptions" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/platform/organizations": {
      get: {
        summary: "Lista tenants para administración de plataforma.",
        operationId: "listPlatformOrganizations",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 160 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
        ],
        responses: { "200": { description: "Página de organizaciones.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfPlatformOrganizations" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea un tenant, su rol inicial de administrador y una invitación.",
        operationId: "createOrganization",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateOrganizationRequest" } } } },
        responses: { "201": { description: "Tenant creado." }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/platform/organizations/{organizationId}": {
      patch: {
        summary: "Actualiza o suspende/reactiva un tenant.",
        operationId: "updatePlatformOrganization",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "organizationId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformOrganizationUpdate" } } } },
        responses: { "200": { description: "Organización actualizada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
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
      CreateRoleRequest: {
        type: "object",
        required: ["name", "permissionCodes"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          permissionCodes: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 100 } },
        },
        additionalProperties: false,
      },
      UpdateRoleRequest: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          permissionCodes: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", maxLength: 100 } },
        },
        additionalProperties: false,
      },
      PermissionCatalogItem: {
        type: "object", required: ["code", "description"], additionalProperties: false,
        properties: { code: { type: "string" }, description: { type: "string" } },
      },
      OrganizationRole: {
        type: "object", required: ["id", "code", "name", "status", "permissions", "assignmentCount", "createdAt"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, permissions: { type: "array", items: { type: "string" } },
          assignmentCount: { type: "integer" }, createdAt: { type: "string", format: "date-time" },
        },
      },
      OrganizationRoleMutationResult: {
        type: "object", required: ["id", "code", "name", "status", "permissions"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, permissions: { type: "array", items: { type: "string" } },
        },
      },
      RoleAssignmentCreated: {
        type: "object", required: ["id", "membershipId", "roleId", "scopeType", "companyId", "branchId"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, membershipId: { type: "string", format: "uuid" }, roleId: { type: "string", format: "uuid" },
          scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] },
          companyId: { type: ["string", "null"], format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" },
        },
      },
      RoleAssignment: {
        type: "object", required: ["id", "membershipId", "userEmail", "userDisplayName", "roleId", "roleCode", "roleName", "roleStatus", "scopeType", "companyId", "companyName", "branchId", "branchName", "createdAt"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, membershipId: { type: "string", format: "uuid" },
          userEmail: { type: "string", format: "email" }, userDisplayName: { type: "string" }, roleId: { type: "string", format: "uuid" },
          roleCode: { type: "string" }, roleName: { type: "string" }, roleStatus: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] },
          companyId: { type: ["string", "null"], format: "uuid" }, companyName: { type: ["string", "null"] },
          branchId: { type: ["string", "null"], format: "uuid" }, branchName: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" },
        },
      },
      RoleAssignmentOption: {
        type: "object", required: ["id", "name", "detail"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, detail: { type: "string" } },
      },
      PageOfRoles: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/OrganizationRole" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      PageOfRoleAssignments: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/RoleAssignment" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      PageOfRoleAssignmentOptions: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/RoleAssignmentOption" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      RoleAssignmentMutation: {
        type: "object",
        required: ["membershipId", "roleId", "scopeType"],
        properties: {
          membershipId: { type: "string", format: "uuid" },
          roleId: { type: "string", format: "uuid" },
          scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] },
          companyId: { type: "string", format: "uuid" },
          branchId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
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
      MembershipStatusMutation: {
        type: "object", required: ["status"], additionalProperties: false,
        properties: { status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
      },
      PlatformOrganizationUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { name: { type: "string", minLength: 1, maxLength: 160 }, status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
      },
      CompanyMutation: {
        type: "object", required: ["legalName"], additionalProperties: false,
        properties: { legalName: { type: "string", minLength: 1, maxLength: 200 }, tradeName: { type: ["string", "null"], maxLength: 200 }, nit: { type: ["string", "null"], maxLength: 40 }, contact: { type: ["string", "null"], maxLength: 300 }, address: { type: ["string", "null"], maxLength: 500 } },
      },
      CompanyUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { legalName: { type: "string", minLength: 1, maxLength: 200 }, tradeName: { type: ["string", "null"], maxLength: 200 }, nit: { type: ["string", "null"], maxLength: 40 }, contact: { type: ["string", "null"], maxLength: 300 }, address: { type: ["string", "null"], maxLength: 500 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
      },
      BranchMutation: {
        type: "object", required: ["code", "name"], additionalProperties: false,
        properties: { code: { type: "string", minLength: 1, maxLength: 40 }, name: { type: "string", minLength: 1, maxLength: 160 }, address: { type: ["string", "null"], maxLength: 500 }, contact: { type: ["string", "null"], maxLength: 300 } },
      },
      BranchUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { code: { type: "string", minLength: 1, maxLength: 40 }, name: { type: "string", minLength: 1, maxLength: 160 }, address: { type: ["string", "null"], maxLength: 500 }, contact: { type: ["string", "null"], maxLength: 300 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
      },
      PlatformOrganization: {
        type: "object", required: ["id", "name", "status", "createdAt", "updatedAt"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } },
      },
      Company: {
        type: "object", required: ["id", "legalName", "tradeName", "nit", "contact", "address", "status", "createdAt", "updatedAt"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, legalName: { type: "string" }, tradeName: { type: ["string", "null"] }, nit: { type: ["string", "null"] }, contact: { type: ["string", "null"] }, address: { type: ["string", "null"] }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } },
      },
      Branch: {
        type: "object", required: ["id", "companyId", "companyName", "code", "name", "address", "contact", "status", "createdAt", "updatedAt"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, companyId: { type: "string", format: "uuid" }, companyName: { type: "string" }, code: { type: "string" }, name: { type: "string" }, address: { type: ["string", "null"] }, contact: { type: ["string", "null"] }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } },
      },
      PageOfPlatformOrganizations: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/PlatformOrganization" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      PageOfCompanies: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/Company" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      PageOfBranches: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/Branch" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
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
