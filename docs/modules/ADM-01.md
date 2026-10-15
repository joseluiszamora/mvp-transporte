# ADM-01 — Empresas y sucursales
## Entidades
Organization, Company, Branch.
## Reglas y alcance
Plataforma crea/activa tenant y administrador inicial; cliente administra razones sociales y sucursales. Código sucursal único por empresa; desactivación conserva históricos. Desactivar tenant bloquea su operación; desactivar empresa/sucursal bloquea escrituras operativas bajo ese alcance.
El código se recorta y normaliza a mayúsculas; su unicidad no distingue mayúsculas dentro de una empresa. El mismo código puede repetirse en otra empresa. Empresas y sucursales se desactivan sin borrado físico; `update` permite reactivarlas y `deactivate` permite desactivarlas.
## Panel web
Panel plataforma de organizaciones; selector organización/empresa; formularios fiscales/contacto; listado sucursales.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
`GET/POST /api/v1/platform/organizations` lista y crea tenants; `PATCH /api/v1/platform/organizations/{organizationId}` mantiene nombre y estado. `GET/POST /api/v1/organizations/companies`, `PATCH/DELETE /api/v1/organizations/companies/{companyId}`, `GET /api/v1/organizations/branches`, `POST /api/v1/organizations/companies/{companyId}/branches`, `PATCH/DELETE /api/v1/organizations/branches/{branchId}` implementan listados y CRUD por tenant. DELETE desactiva y conserva historial.
Contratos, validaciones, scopes, filtros y errores quedan descritos en OpenAPI. Listados filtran filas por cada permiso efectivo de empresa o sucursal antes de paginar. No se exponen campos ORM ni IDs de otro tenant; recurso ajeno responde 404 y permiso conocido insuficiente 403.
## Aceptación
Crear dos tenants con empresas y sucursales; IDs ajenos nunca permiten lectura/escritura. Auditar cambios; proteger último administrador.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
