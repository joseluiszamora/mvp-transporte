# ADM-04 — Roles y permisos
## Entidades
Role, Permission, RolePermission, RoleAssignment.
## Reglas y alcance
Aplicar docs/access-matrix.md; scopes tipados. Consultar permisos efectivos para UI; autorización backend independiente. No autoescalada; no retirar último admin.
## Panel web
Editor de roles, matriz permisos, asignación de alcance.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Operación prohibida falla por API directa; scope de sucursal no amplía empresa; cambio de rol efectivo en próxima solicitud.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
