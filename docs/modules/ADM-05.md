# ADM-05 — Personal
## Entidades
Employee, Position vía catálogo, EmployeeBranchAssignment, EmployeeDocument.
## Reglas y alcance
Identidad/contacto opcional según formulario; laboral: código, empresa, cargo, sucursales, ingreso, estado. User opcional. Empleado sin cuenta no entra; visor con cuenta. Datos personales y documentos requieren permisos específicos.
## Panel web
Listado laboral, detalle restringido, foto, vínculo de usuario, documentos.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Supervisor recibe solo datos laborales incluso llamando API; archivos personales requieren permiso; asignaciones de sucursal propia.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
