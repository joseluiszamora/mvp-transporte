# ADM-01 — Empresas y sucursales
## Entidades
Organization, Company, Branch.
## Reglas y alcance
Plataforma crea/activa tenant y administrador inicial; cliente administra razones sociales y sucursales. Código sucursal único por empresa; desactivación conserva históricos. Desactivar tenant bloquea su operación; desactivar empresa/sucursal bloquea escrituras operativas bajo ese alcance.
## Panel web
Panel plataforma de organizaciones; selector organización/empresa; formularios fiscales/contacto; listado sucursales.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Crear dos tenants con empresas y sucursales; IDs ajenos nunca permiten lectura/escritura. Auditar cambios; proteger último administrador.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
