# ADM-10 — Catálogos
## Entidades
Catalog, CatalogItem.
## Reglas y alcance
Globales protegidos y propios tenant/empresa. Tipos documentos, cargos, clasificaciones. Unicidad código por scope; referencias activas conservan históricos; desactivar en vez de borrar. Estados internos de seguridad no editables.
## Panel web
Listado/edición, scope y marcador protegido.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Cliente no cambia global protegido; códigos repetidos mismo scope rechazados; valores ajenos no referenciables; inactivos no nuevos registros.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
