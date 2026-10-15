# ADM-10 — Catálogos
## Entidades
`Catalog` contiene `CatalogItem`. Alcances: global, organización y empresa. Código, nombre, descripción opcional y estado; cada catálogo declara si está protegido.
## Reglas y alcance
Los catálogos globales son de sistema y protegidos. Los clientes pueden crear catálogos propios de organización o empresa según `catalogs.manage`. Tipos de documentos, cargos y clasificaciones generales. Códigos en mayúsculas; el código de catálogo queda estable tras crearlo; la unicidad de catálogo es por alcance y la de opción dentro del catálogo. Desactivar conserva IDs para futuras referencias; no existe borrado físico. Opciones activas de un catálogo inactivo no se ofrecen para nuevos registros. Los estados internos de seguridad no son editables como catálogos.
## Panel web
Listado/edición, scope y marcador protegido.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato `/api/v1/catalogs` definido en OpenAPI: listar/crear catálogos, opciones de scope disponibles, listar/crear opciones y actualizar/desactivar catálogos/opciones. `catalogs.read` permite leer globales y recursos propios en el alcance exacto; `catalogs.manage` permite mutarlos en ese mismo alcance. Un permiso de sucursal no se amplía a toda su empresa porque los catálogos no tienen alcance sucursal. Los globales requieren lectura del tenant y no aceptan mutaciones. No exponer ORM ni campos restringidos. Recurso ajeno/inaccesible responde 404; falta del permiso requerido responde 403.
## Aceptación
Cliente no cambia global protegido; códigos repetidos en el mismo scope rechazados y permitidos en otros scopes; desactivación conserva la fila/ID; opciones de catálogo inactivo no se ofrecen para nuevos registros.
## Seeds iniciales
La migración crea dos catálogos globales protegidos: tipos de documento de personal y cargos. Incluye opciones generales (CI, pasaporte, NIT, matrícula profesional, administrador/a, supervisor/a, analista, operador/a, asistente y otro); no incluye opciones específicas de transporte.
## Validación transversal
Dos tenants; varias empresas; alcances organización/empresa; usuario sin permiso; protección global; unicidad y bajas lógicas. Registrar mutaciones sensibles y documentar cambios.
