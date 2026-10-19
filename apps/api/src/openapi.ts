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
    "/api/v1/catalogs": {
      get: {
        summary: "Lista catálogos globales de solo lectura y catálogos propios autorizados.",
        operationId: "listCatalogs",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 160 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
          { in: "query", name: "scope", schema: { type: "string", enum: ["GLOBAL", "ORGANIZATION", "COMPANY"] } },
        ],
        responses: { "200": { description: "Página de catálogos accesibles.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfCatalogs" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea un catálogo propio en el tenant o empresa autorizados.",
        operationId: "createCatalog",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogMutation" } } } },
        responses: { "201": { description: "Catálogo creado.", content: { "application/json": { schema: { $ref: "#/components/schemas/Catalog" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/catalogs/scope-options": {
      get: {
        summary: "Lista alcances de catálogo y empresas en las que el actor puede gestionar catálogos.",
        operationId: "listCatalogScopeOptions",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Opciones de alcance autorizadas.", content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogScopeOptions" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/catalogs/{catalogId}": {
      patch: {
        summary: "Actualiza o desactiva un catálogo propio; los protegidos no se modifican.",
        operationId: "updateCatalog",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogUpdate" } } } },
        responses: { "200": { description: "Catálogo actualizado.", content: { "application/json": { schema: { $ref: "#/components/schemas/Catalog" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
      delete: {
        summary: "Desactiva el catálogo y conserva su historial.",
        operationId: "deactivateCatalog",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "Catálogo desactivado." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/catalogs/{catalogId}/items": {
      get: {
        summary: "Lista opciones de un catálogo accesible.",
        operationId: "listCatalogItems",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 160 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
        ],
        responses: { "200": { description: "Página de opciones.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfCatalogItems" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Agrega una opción a un catálogo propio activo.",
        operationId: "createCatalogItem",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogItemMutation" } } } },
        responses: { "201": { description: "Opción creada.", content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogItem" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/catalogs/{catalogId}/items/{itemId}": {
      patch: {
        summary: "Actualiza o desactiva una opción sin borrar la fila.",
        operationId: "updateCatalogItem",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } },
          { in: "path", name: "itemId", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogItemUpdate" } } } },
        responses: { "200": { description: "Opción actualizada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
      delete: {
        summary: "Desactiva una opción y mantiene su identificador para referencias históricas.",
        operationId: "deactivateCatalogItem",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "path", name: "catalogId", required: true, schema: { type: "string", format: "uuid" } },
          { in: "path", name: "itemId", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "204": { description: "Opción desactivada." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings": {
      get: {
        summary: "Lista overrides de configuración del alcance exacto autorizado.",
        operationId: "listSettings",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "branchId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de overrides autorizados.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfSettings" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      put: {
        summary: "Crea, actualiza o quita un override tipado en un scope permitido.",
        operationId: "updateSetting",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SettingMutation" } } } },
        responses: { "200": { description: "Override actualizado o eliminado.", content: { "application/json": { schema: { $ref: "#/components/schemas/SettingMutationResult" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/effective": {
      get: {
        summary: "Resuelve configuración efectiva de instalación a sucursal según la allowlist de cada clave.",
        operationId: "getEffectiveSettings",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "branchId", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Configuración efectiva autorizada.", content: { "application/json": { schema: { $ref: "#/components/schemas/EffectiveSettings" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/scope-options": {
      get: {
        summary: "Lista empresas y sucursales activas alcanzables por permisos efectivos de configuración.",
        operationId: "listSettingsScopeOptions",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Opciones autorizadas de alcance.", content: { "application/json": { schema: { $ref: "#/components/schemas/SettingsScopeOptions" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/installation": {
      get: {
        summary: "Lee defaults no secretos de instalación; requiere rol de plataforma.", operationId: "getInstallationSettings", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Overrides de instalación.", content: { "application/json": { schema: { $ref: "#/components/schemas/InstallationSettings" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      put: {
        summary: "Actualiza un default no secreto de instalación; SMTP permanece separado.", operationId: "updateInstallationSetting", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InstallationSettingMutation" } } } },
        responses: { "200": { description: "Default de instalación actualizado o eliminado.", content: { "application/json": { schema: { $ref: "#/components/schemas/SettingMutationResult" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/business-hours": {
      get: {
        summary: "Devuelve los horarios efectivos de empresa o sucursal.", operationId: "getBusinessHours", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", required: true, schema: { type: "string", format: "uuid" } },
          { in: "query", name: "branchId", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Siete días ISO y hasta dos intervalos locales por día.", content: { "application/json": { schema: { $ref: "#/components/schemas/BusinessHours" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      put: {
        summary: "Reemplaza los siete días de horarios de empresa o sucursal.", operationId: "replaceBusinessHours", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BusinessHoursMutation" } } } },
        responses: { "200": { description: "Horario actualizado y auditado.", content: { "application/json": { schema: { $ref: "#/components/schemas/BusinessHoursMutationResult" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/number-sequences": {
      get: {
        summary: "Lista numeraciones en un alcance autorizado.", operationId: "listNumberSequences", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "branchId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de numeraciones.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfNumberSequences" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea una numeración en organización, empresa o sucursal.", operationId: "createNumberSequence", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NumberSequenceMutation" } } } },
        responses: { "201": { description: "Numeración creada.", content: { "application/json": { schema: { $ref: "#/components/schemas/NumberSequence" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/number-sequences/{sequenceId}": {
      patch: {
        summary: "Actualiza prefijo o relleno solo mientras no se emitió ningún número.", operationId: "updateNumberSequence", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "sequenceId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NumberSequenceUpdate" } } } },
        responses: { "200": { description: "Numeración actualizada.", content: { "application/json": { schema: { $ref: "#/components/schemas/NumberSequence" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/settings/number-sequences/{sequenceId}/next": {
      post: {
        summary: "Emite un número de forma atómica; el contador no retrocede.", operationId: "issueNumber", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "sequenceId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Número emitido y auditado.", content: { "application/json": { schema: { $ref: "#/components/schemas/IssuedNumber" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/audit": {
      get: {
        summary: "Lista eventos inmutables de la organización y alcances autorizados.", operationId: "listAuditEvents", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "from", schema: { type: "string", format: "date-time" } },
          { in: "query", name: "to", schema: { type: "string", format: "date-time" } },
          { in: "query", name: "actorId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "action", schema: { type: "string", maxLength: 100 } },
          { in: "query", name: "resourceType", schema: { type: "string", maxLength: 100 } },
          { in: "query", name: "resourceId", schema: { type: "string", maxLength: 100 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de eventos filtrada por permiso y alcance.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfAuditEvents" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/audit/{eventId}": {
      get: {
        summary: "Consulta un evento dentro de la organización y alcance autorizados; el detalle se sanitiza al leer.", operationId: "getAuditEvent", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "eventId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Detalle inmutable del evento.", content: { "application/json": { schema: { $ref: "#/components/schemas/AuditEventResponse" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/notifications/access": {
      get: {
        summary: "Devuelve si el usuario puede consultar el historial de correo de la organización seleccionada.", operationId: "getNotificationAccess", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Acceso efectivo a historial organización.", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationAccess" } } } }, "401": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/notifications/smtp": {
      get: {
        summary: "Consulta la configuración SMTP sin devolver la contraseña.", operationId: "getInstallationSmtpSettings", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Configuración SMTP redacteda.", content: { "application/json": { schema: { $ref: "#/components/schemas/InstallationSmtpSettings" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      put: {
        summary: "Guarda el SMTP de instalación y cifra su contraseña en el servidor.", operationId: "saveInstallationSmtpSettings", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InstallationSmtpSettingsMutation" } } } },
        responses: { "200": { description: "Configuración guardada sin devolver la contraseña.", content: { "application/json": { schema: { $ref: "#/components/schemas/InstallationSmtpSettings" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "503": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/notifications/smtp/test": {
      post: {
        summary: "Envía un mensaje de prueba al correo elegido por un administrador de plataforma.", operationId: "sendSmtpTest", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["recipient"], properties: { recipient: { type: "string", format: "email", maxLength: 320 } } } } } },
        responses: { "200": { description: "El servidor SMTP aceptó el mensaje." }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "503": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/notifications/templates": {
      get: {
        summary: "Lista las plantillas de sistema visibles para una organización autorizada.", operationId: "listEmailTemplates", security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Plantillas disponibles.", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/EmailTemplateSummary" } } } } } } },
          "403": { $ref: "#/components/responses/ApiError" },
        },
      },
    },
    "/api/v1/notifications/deliveries": {
      get: {
        summary: "Lista resultados sanitizados del outbox en el tenant seleccionado; requiere notifications.read a nivel de organización.", operationId: "listEmailDeliveries", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "outcome", schema: { type: "string", enum: ["SENT", "FAILED"] } },
          { in: "query", name: "templateCode", schema: { type: "string", maxLength: 100 } },
          { in: "query", name: "from", schema: { type: "string", format: "date-time" } },
          { in: "query", name: "to", schema: { type: "string", format: "date-time" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página sin destinatarios ni contenido del correo.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfEmailDeliveries" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/employees/scope-options": {
      get: {
        summary: "Lista empresas, sucursales, cargos, tipos de documento y cuentas disponibles dentro del alcance autorizado.", operationId: "listEmployeeScopeOptions", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Opciones filtradas por permisos efectivos.", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeScopeOptions" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/employees": {
      get: {
        summary: "Lista únicamente datos laborales mínimos de empleados en empresas y sucursales autorizadas.", operationId: "listEmployees", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
          { in: "query", name: "companyId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "branchId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página laboral autorizada.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfEmployees" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Crea un empleado sin exigir una cuenta de usuario.", operationId: "createEmployee", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeCreate" } } } },
        responses: { "201": { description: "Empleado creado.", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeDetailsResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/employees/{employeeId}": {
      get: {
        summary: "Consulta un empleado y agrega datos personales solo con employees.personal.read.", operationId: "getEmployee", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Detalle limitado por permisos.", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeDetailsResponse" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      patch: {
        summary: "Actualiza datos laborales, datos personales protegidos y asignaciones accesibles.", operationId: "updateEmployee", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeMutation" } } } },
        responses: { "200": { description: "Empleado actualizado y auditado.", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeDetailsResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/employees/{employeeId}/documents": {
      get: {
        summary: "Lista documentos solo con employees.read, employee_documents.read y files.read.", operationId: "listEmployeeDocuments", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Documentos privados del empleado.", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeDocuments" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Carga documento privado y sus metadatos del catálogo vigente.", operationId: "uploadEmployeeDocument", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file", "typeId"], properties: { file: { type: "string", format: "binary" }, typeId: { type: "string", format: "uuid" }, issuedAt: { type: "string", format: "date" }, expiresAt: { type: "string", format: "date" } }, additionalProperties: false } } } },
        responses: { "201": { description: "Documento privado cargado.", content: { "application/json": { schema: { $ref: "#/components/schemas/StoredFileResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "413": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/employees/{employeeId}/photo": {
      post: {
        summary: "Carga o reemplaza la foto privada del empleado; acepta JPEG, PNG o WEBP.", operationId: "uploadEmployeePhoto", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } }, additionalProperties: false } } } },
        responses: { "201": { description: "Foto privada guardada.", content: { "application/json": { schema: { $ref: "#/components/schemas/StoredFileResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "413": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/files/scope-options": {
      get: {
        summary: "Lista empresas y sucursales para las que los permisos de archivos y del recurso coinciden.", operationId: "listFileScopeOptions", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de recursos accesibles.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfFileScopeOptions" } } } }, "403": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/files": {
      get: {
        summary: "Lista adjuntos del recurso autorizado exacto.", operationId: "listFiles", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "resourceType", required: true, schema: { $ref: "#/components/schemas/FileResourceType" } },
          { in: "query", name: "resourceId", required: true, schema: { type: "string", format: "uuid" } },
          { in: "query", name: "search", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Página de metadatos privados.", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfFiles" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      post: {
        summary: "Carga un archivo privado al recurso exacto autorizado.", operationId: "uploadFile", security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "resourceType", required: true, schema: { $ref: "#/components/schemas/FileResourceType" } },
          { in: "query", name: "resourceId", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } }, additionalProperties: false } } } },
        responses: { "201": { description: "Archivo privado guardado.", content: { "application/json": { schema: { $ref: "#/components/schemas/StoredFileResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "413": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/files/{fileId}": {
      get: {
        summary: "Consulta metadatos de un archivo solo si el actor conserva acceso al recurso enlazado.", operationId: "getFileMetadata", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "fileId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Metadatos autorizados.", content: { "application/json": { schema: { $ref: "#/components/schemas/StoredFileResponse" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
      delete: {
        summary: "Quita el enlace autorizado y programa la purga tras 24 horas.", operationId: "requestFileDeletion", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "fileId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "El archivo dejó de estar disponible y será purgado tras el periodo de gracia." }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
      },
    },
    "/api/v1/files/{fileId}/content": {
      get: {
        summary: "Descarga en streaming un archivo privado tras autorizar su recurso.", operationId: "downloadFile", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "fileId", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Contenido servido como adjunto con MIME detectado y no-store.", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } },
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
      AuditEventSummary: {
        type: "object", additionalProperties: false,
        required: ["id", "companyId", "branchId", "actorId", "actorType", "action", "resourceType", "resourceId", "requestId", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" }, companyId: { type: ["string", "null"], format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" },
          actorId: { type: ["string", "null"], format: "uuid" }, actorType: { type: "string", enum: ["USER", "SYSTEM"] }, action: { type: "string" },
          resourceType: { type: "string" }, resourceId: { type: ["string", "null"] }, requestId: { type: "string" }, createdAt: { type: "string", format: "date-time" },
        },
      },
      AuditEventDetails: {
        allOf: [{ $ref: "#/components/schemas/AuditEventSummary" }, {
          type: "object", additionalProperties: false, required: ["diff"], properties: { diff: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] } },
        }],
      },
      AuditEventResponse: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { $ref: "#/components/schemas/AuditEventDetails" } } },
      PageOfAuditEvents: { type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/AuditEventSummary" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } },
      NotificationAccess: { type: "object", additionalProperties: false, required: ["canReadHistory"], properties: { canReadHistory: { type: "boolean" } } },
      InstallationSmtpSettings: {
        type: "object", additionalProperties: false, required: ["source", "configured", "host", "port", "secure", "requireTls", "fromAddress", "username", "passwordConfigured", "updatedAt"],
        properties: { source: { type: "string", enum: ["DATABASE", "ENVIRONMENT", "UNCONFIGURED"] }, configured: { type: "boolean" }, host: { type: "string" }, port: { type: "integer" }, secure: { type: "boolean" }, requireTls: { type: "boolean" }, fromAddress: { type: "string" }, username: { type: "string" }, passwordConfigured: { type: "boolean" }, updatedAt: { type: ["string", "null"], format: "date-time" } },
      },
      InstallationSmtpSettingsMutation: {
        type: "object", additionalProperties: false, required: ["host", "port", "secure", "requireTls", "fromAddress"],
        properties: { host: { type: "string", minLength: 1, maxLength: 255 }, port: { type: "integer", minimum: 1, maximum: 65535 }, secure: { type: "boolean" }, requireTls: { type: "boolean" }, fromAddress: { type: "string", minLength: 1, maxLength: 320 }, username: { type: ["string", "null"], maxLength: 320 }, password: { type: "string", maxLength: 1024 }, clearPassword: { type: "boolean" } },
      },
      EmailTemplateSummary: { type: "object", additionalProperties: false, required: ["code", "subject", "status", "updatedAt"], properties: { code: { type: "string" }, subject: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, updatedAt: { type: "string", format: "date-time" } } },
      EmailDeliverySummary: { type: "object", additionalProperties: false, required: ["id", "templateCode", "attempt", "outcome", "errorCode", "createdAt"], properties: { id: { type: "string", format: "uuid" }, templateCode: { type: "string" }, attempt: { type: "integer" }, outcome: { type: "string", enum: ["SENT", "FAILED"] }, errorCode: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" } } },
      PageOfEmailDeliveries: { type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/EmailDeliverySummary" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } },
      EmployeeListItem: {
        type: "object", additionalProperties: false,
        required: ["id", "companyId", "internalCode", "firstNames", "lastNames", "position", "hireDate", "status", "branches"],
        properties: {
          id: { type: "string", format: "uuid" }, companyId: { type: "string", format: "uuid" }, internalCode: { type: "string" },
          firstNames: { type: "string" }, lastNames: { type: "string" }, hireDate: { type: "string", format: "date" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          position: { oneOf: [{ $ref: "#/components/schemas/EmployeeCatalogItem" }, { type: "null" }] },
          branches: { type: "array", items: { $ref: "#/components/schemas/EmployeeBranch" } },
        },
      },
      EmployeeCatalogItem: { type: "object", additionalProperties: false, required: ["id", "code", "name"], properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" } } },
      EmployeeBranch: { type: "object", additionalProperties: false, required: ["id", "code", "name"], properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" } } },
      EmployeeDetails: {
        allOf: [{ $ref: "#/components/schemas/EmployeeListItem" }, {
          type: "object", additionalProperties: false,
          required: ["canReadPersonalData", "canReadLinkedUser", "canManageUserLink", "canUpdate", "canUpdateSharedFields", "canDeactivate", "canManagePersonalData", "canReadPhoto", "canManagePhoto", "canDeletePhoto", "canReadDocuments", "canDownloadDocuments", "canManageDocuments", "canDeleteDocuments"],
          properties: {
            canReadPersonalData: { type: "boolean" }, canReadLinkedUser: { type: "boolean" }, canManageUserLink: { type: "boolean" }, canUpdate: { type: "boolean" }, canUpdateSharedFields: { type: "boolean" }, canDeactivate: { type: "boolean" },
            canManagePersonalData: { type: "boolean" }, canReadPhoto: { type: "boolean" }, canManagePhoto: { type: "boolean" }, canDeletePhoto: { type: "boolean" },
            canReadDocuments: { type: "boolean" }, canDownloadDocuments: { type: "boolean" }, canManageDocuments: { type: "boolean" }, canDeleteDocuments: { type: "boolean" },
            personalData: { type: "object", additionalProperties: false, properties: { documentNumber: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, email: { type: ["string", "null"] }, address: { type: ["string", "null"] } } },
            linkedUser: { oneOf: [{ type: "object", additionalProperties: false, required: ["id", "displayName", "email", "membershipStatus"], properties: { id: { type: "string", format: "uuid" }, displayName: { type: "string" }, email: { type: "string", format: "email" }, membershipStatus: { type: "string", enum: ["INVITED", "ACTIVE", "SUSPENDED"] } } }, { type: "null" }] },
            photoFileId: { type: ["string", "null"], format: "uuid" },
          },
        }],
      },
      EmployeeDetailsResponse: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { $ref: "#/components/schemas/EmployeeDetails" } } },
      PageOfEmployees: { type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/EmployeeListItem" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } },
      EmployeeMutation: {
        type: "object", additionalProperties: false,
        properties: {
          companyId: { type: "string", format: "uuid" },
          internalCode: { type: "string", minLength: 1, maxLength: 60 }, firstNames: { type: "string", minLength: 1, maxLength: 120 }, lastNames: { type: "string", minLength: 1, maxLength: 120 },
          personalDocumentNumber: { type: ["string", "null"], maxLength: 80 }, personalPhone: { type: ["string", "null"], maxLength: 40 }, personalEmail: { type: ["string", "null"], format: "email", maxLength: 320 }, personalAddress: { type: ["string", "null"], maxLength: 500 },
          positionId: { type: ["string", "null"], format: "uuid" }, hireDate: { type: "string", format: "date" }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, userId: { type: ["string", "null"], format: "uuid" },
          branchIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
        },
      },
      EmployeeCreate: {
        allOf: [{ $ref: "#/components/schemas/EmployeeMutation" }, {
          type: "object", required: ["companyId", "internalCode", "firstNames", "lastNames", "hireDate"],
        }],
      },
      EmployeeScopeOptions: {
        type: "object", additionalProperties: false, required: ["companies", "positions", "documentTypes", "users"],
        properties: {
          companies: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["id", "legalName", "canCreate", "canUpdate", "branches"],
              properties: {
                id: { type: "string", format: "uuid" }, legalName: { type: "string" }, canCreate: { type: "boolean" }, canUpdate: { type: "boolean" },
                branches: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false, required: ["id", "code", "name", "canCreate", "canUpdate"],
                    properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, canCreate: { type: "boolean" }, canUpdate: { type: "boolean" } },
                  },
                },
              },
            },
          },
          positions: { type: "array", items: { $ref: "#/components/schemas/EmployeeCatalogItem" } },
          documentTypes: { type: "array", items: { $ref: "#/components/schemas/EmployeeCatalogItem" } },
          users: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["id", "displayName", "email", "membershipStatus"],
              properties: { id: { type: "string", format: "uuid" }, displayName: { type: "string" }, email: { type: "string", format: "email" }, membershipStatus: { type: "string", enum: ["INVITED", "ACTIVE", "SUSPENDED"] } },
            },
          },
        },
      },
      EmployeeDocuments: {
        type: "object", additionalProperties: false, required: ["items", "canDownload"],
        properties: {
          canDownload: { type: "boolean" },
          items: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["id", "fileId", "type", "originalName", "detectedMime", "bytes", "issuedAt", "expiresAt", "createdAt"],
              properties: {
                id: { type: "string", format: "uuid" }, fileId: { type: "string", format: "uuid" }, type: { $ref: "#/components/schemas/EmployeeCatalogItem" },
                originalName: { type: "string" }, detectedMime: { type: "string", enum: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
                bytes: { type: "integer" }, issuedAt: { type: ["string", "null"], format: "date" }, expiresAt: { type: ["string", "null"], format: "date" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      FileResourceType: { type: "string", enum: ["COMPANY_ATTACHMENT", "BRANCH_ATTACHMENT", "EMPLOYEE_PHOTO", "EMPLOYEE_DOCUMENT"] },
      FileScopeOption: {
        type: "object", additionalProperties: false,
        required: ["resourceType", "resourceId", "companyId", "branchId", "label", "canRead", "canDownload", "canUpload", "canDelete"],
        properties: {
          resourceType: { $ref: "#/components/schemas/FileResourceType" }, resourceId: { type: "string", format: "uuid" },
          companyId: { type: "string", format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" }, label: { type: "string" },
          canRead: { type: "boolean" }, canDownload: { type: "boolean" }, canUpload: { type: "boolean" }, canDelete: { type: "boolean" },
        },
      },
      PageOfFileScopeOptions: {
        type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"],
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/FileScopeOption" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      StoredFile: {
        type: "object", additionalProperties: false,
        required: ["id", "resourceType", "resourceId", "originalName", "detectedMime", "bytes", "createdAt", "downloadUrl"],
        properties: {
          id: { type: "string", format: "uuid" }, resourceType: { $ref: "#/components/schemas/FileResourceType" }, resourceId: { type: "string", format: "uuid" },
          originalName: { type: "string", maxLength: 255 }, detectedMime: { type: "string", enum: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
          bytes: { type: "integer", minimum: 1, maximum: 10485760 }, createdAt: { type: "string", format: "date-time" }, downloadUrl: { type: "string" },
        },
      },
      StoredFileResponse: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { $ref: "#/components/schemas/StoredFile" } } },
      PageOfFiles: {
        type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"],
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/StoredFile" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
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
      Catalog: {
        type: "object", required: ["id", "code", "name", "description", "scope", "organizationId", "companyId", "companyName", "status", "protected", "canManage", "createdAt", "updatedAt"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] },
          scope: { type: "string", enum: ["GLOBAL", "ORGANIZATION", "COMPANY"] }, organizationId: { type: ["string", "null"], format: "uuid" },
          companyId: { type: ["string", "null"], format: "uuid" }, companyName: { type: ["string", "null"] }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          protected: { type: "boolean" }, canManage: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      CatalogItem: {
        type: "object", required: ["id", "catalogId", "code", "name", "description", "status", "createdAt", "updatedAt"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, catalogId: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } },
      },
      CatalogMutation: {
        type: "object", required: ["code", "name", "scope"], additionalProperties: false,
        properties: { code: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: ["string", "null"], maxLength: 500 }, scope: { type: "string", enum: ["ORGANIZATION", "COMPANY"] }, companyId: { type: "string", format: "uuid" } },
      },
      CatalogUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: ["string", "null"], maxLength: 500 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
      },
      CatalogItemMutation: {
        type: "object", required: ["code", "name"], additionalProperties: false,
        properties: { code: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: ["string", "null"], maxLength: 500 } },
      },
      CatalogItemUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { code: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: ["string", "null"], maxLength: 500 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
      },
      CatalogScopeOptions: {
        type: "object", required: ["organization", "companies", "totalCompanies", "limit", "offset"], additionalProperties: false,
        properties: { organization: { type: "boolean" }, companies: { type: "array", items: { type: "object", required: ["id", "legalName"], additionalProperties: false, properties: { id: { type: "string", format: "uuid" }, legalName: { type: "string" } } } }, totalCompanies: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      Setting: {
        type: "object", required: ["id", "scopeType", "organizationId", "companyId", "branchId", "key", "valueType", "value", "updatedAt"], additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" }, scopeType: { type: "string", enum: ["INSTALLATION", "ORGANIZATION", "COMPANY", "BRANCH"] },
          organizationId: { type: ["string", "null"], format: "uuid" }, companyId: { type: ["string", "null"], format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" },
          key: { type: "string", enum: ["locale", "currency", "timeZone", "identity.name", "identity.logoUrl", "identity.brandColor"] },
          valueType: { type: "string", const: "STRING" }, value: { type: "string" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      EffectiveSetting: {
        type: "object", required: ["key", "valueType", "value", "sourceScopeType", "sourceOrganizationId", "sourceCompanyId", "sourceBranchId", "updatedAt"], additionalProperties: false,
        properties: {
          key: { type: "string", enum: ["locale", "currency", "timeZone", "identity.name", "identity.logoUrl", "identity.brandColor"] },
          valueType: { type: "string", const: "STRING" }, value: { type: ["string", "null"] },
          sourceScopeType: { type: ["string", "null"], enum: ["INSTALLATION", "ORGANIZATION", "COMPANY", "BRANCH", null] },
          sourceOrganizationId: { type: ["string", "null"], format: "uuid" }, sourceCompanyId: { type: ["string", "null"], format: "uuid" }, sourceBranchId: { type: ["string", "null"], format: "uuid" },
          updatedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      EffectiveSettings: {
        type: "object", required: ["target", "items"], additionalProperties: false,
        properties: {
          target: { type: "object", required: ["scopeType", "organizationId", "companyId", "branchId"], additionalProperties: false, properties: { scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] }, organizationId: { type: "string", format: "uuid" }, companyId: { type: ["string", "null"], format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" } } },
          items: { type: "array", items: { $ref: "#/components/schemas/EffectiveSetting" } },
        },
      },
      PageOfSettings: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/Setting" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      SettingMutationResult: {
        type: "object", required: ["item", "deleted"], additionalProperties: false,
        properties: { item: { anyOf: [{ $ref: "#/components/schemas/Setting" }, { type: "null" }] }, deleted: { type: "boolean" } },
      },
      SettingsScopeOptions: {
        type: "object", required: ["organization", "companies", "totalCompanies", "limit", "offset"], additionalProperties: false,
        properties: {
          organization: { type: "object", required: ["canRead", "canUpdate"], additionalProperties: false, properties: { canRead: { type: "boolean" }, canUpdate: { type: "boolean" } } },
          companies: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "legalName", "canRead", "canUpdate", "branches"],
              additionalProperties: false,
              properties: {
                id: { type: "string", format: "uuid" },
                legalName: { type: "string" },
                canRead: { type: "boolean" },
                canUpdate: { type: "boolean" },
                branches: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "code", "name", "canRead", "canUpdate"],
                    additionalProperties: false,
                    properties: {
                      id: { type: "string", format: "uuid" },
                      code: { type: "string" },
                      name: { type: "string" },
                      canRead: { type: "boolean" },
                      canUpdate: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
          totalCompanies: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" },
        },
      },
      InstallationSettings: {
        type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", items: { $ref: "#/components/schemas/Setting" } } },
      },
      SettingMutation: {
        type: "object", required: ["scopeType", "key", "value"], additionalProperties: false,
        properties: {
          scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] }, companyId: { type: "string", format: "uuid" }, branchId: { type: "string", format: "uuid" },
          key: { type: "string", enum: ["locale", "currency", "timeZone", "identity.name", "identity.logoUrl", "identity.brandColor"] }, value: { type: ["string", "null"] },
        },
      },
      InstallationSettingMutation: {
        type: "object", required: ["key", "value"], additionalProperties: false,
        properties: { key: { type: "string", enum: ["locale", "currency", "timeZone"] }, value: { type: ["string", "null"] } },
      },
      BusinessHourInterval: {
        type: "object", required: ["start", "end"], additionalProperties: false,
        properties: { start: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }, end: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" } },
      },
      BusinessHourDay: {
        type: "object", required: ["weekday", "intervals"], additionalProperties: false,
        properties: { weekday: { type: "integer", minimum: 1, maximum: 7 }, intervals: { type: "array", maxItems: 2, items: { $ref: "#/components/schemas/BusinessHourInterval" } }, sourceScopeType: { type: ["string", "null"], enum: ["COMPANY", "BRANCH", null] }, updatedAt: { type: ["string", "null"], format: "date-time" } },
      },
      BusinessHours: {
        type: "object", required: ["target", "items"], additionalProperties: false,
        properties: { target: { type: "object", required: ["scopeType", "organizationId", "companyId", "branchId"], additionalProperties: false, properties: { scopeType: { type: "string", enum: ["COMPANY", "BRANCH"] }, organizationId: { type: "string", format: "uuid" }, companyId: { type: "string", format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" } } }, items: { type: "array", minItems: 7, maxItems: 7, items: { $ref: "#/components/schemas/BusinessHourDay" } } },
      },
      BusinessHoursMutationResult: {
        type: "object", required: ["items"], additionalProperties: false,
        properties: { items: { type: "array", minItems: 7, maxItems: 7, items: { $ref: "#/components/schemas/BusinessHourDay" } } },
      },
      BusinessHoursMutation: {
        type: "object", required: ["companyId", "days"], additionalProperties: false,
        properties: {
          companyId: { type: "string", format: "uuid" },
          branchId: { type: "string", format: "uuid" },
          days: {
            type: "array", minItems: 7, maxItems: 7,
            items: {
              type: "object", required: ["weekday", "intervals"], additionalProperties: false,
              properties: {
                weekday: { type: "integer", minimum: 1, maximum: 7 },
                intervals: { type: "array", maxItems: 2, items: { $ref: "#/components/schemas/BusinessHourInterval" } },
              },
            },
          },
        },
      },
      NumberSequence: {
        type: "object", required: ["id", "scopeType", "organizationId", "companyId", "branchId", "documentType", "period", "prefix", "padding", "nextValue", "updatedAt"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" }, scopeType: { type: "string", enum: ["ORGANIZATION", "COMPANY", "BRANCH"] }, organizationId: { type: "string", format: "uuid" }, companyId: { type: ["string", "null"], format: "uuid" }, branchId: { type: ["string", "null"], format: "uuid" }, documentType: { type: "string" }, period: { type: "string" }, prefix: { type: "string" }, padding: { type: "integer" }, nextValue: { type: "string" }, updatedAt: { type: "string", format: "date-time" } },
      },
      NumberSequenceMutation: {
        type: "object", required: ["documentType", "period", "prefix", "padding"], additionalProperties: false,
        properties: { companyId: { type: "string", format: "uuid" }, branchId: { type: "string", format: "uuid" }, documentType: { type: "string", minLength: 1, maxLength: 60 }, period: { type: "string", pattern: "^(ALL|[0-9]{4}(-[0-9]{2})?)$" }, prefix: { type: "string", maxLength: 24 }, padding: { type: "integer", minimum: 0, maximum: 12 } },
      },
      NumberSequenceUpdate: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { prefix: { type: "string", maxLength: 24 }, padding: { type: "integer", minimum: 0, maximum: 12 } },
      },
      PageOfNumberSequences: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/NumberSequence" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      IssuedNumber: {
        type: "object", required: ["sequenceId", "documentType", "period", "number"], additionalProperties: false,
        properties: { sequenceId: { type: "string", format: "uuid" }, documentType: { type: "string" }, period: { type: "string" }, number: { type: "string" } },
      },
      PageOfCatalogs: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/Catalog" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
      },
      PageOfCatalogItems: {
        type: "object", required: ["items", "total", "limit", "offset"], additionalProperties: false,
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/CatalogItem" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
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
