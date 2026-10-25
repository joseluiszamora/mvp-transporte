# Permisos y roles iniciales
Permisos globales inmutables en código/migraciones. Roles editables por tenant. Defaults conservadores, no sustituyen autorización por alcance.

| Recurso | Acciones |
|---|---|
| organizations | administración de plataforma separada: read/create/update/activate/deactivate |
| companies | read/create/update/deactivate |
| branches | read/create/update/deactivate |
| users | read/create/update/deactivate |
| roles | read/create/update/assign |
| employees | read/create/update/deactivate |
| employee_documents | read/manage |
| settings | read/update |
| catalogs | read/manage (globales de solo lectura; catálogos propios por organización/empresa) |
| files | upload/read/download/delete |
| audit | read |
| notifications | read/manage |

Admin cliente: todos los permisos de cliente dentro de alcance, nunca plataforma. Supervisor: companies.read, branches.read, employees.read/create/update, catalogs.read, files.upload/read/download para recursos laborales autorizados, notifications.read; sin employee_documents ni datos personales restringidos por defecto. Operador: companies.read, branches.read, employees.read limitado a vista laboral, catalogs.read; escrituras adicionales se conceden explícitamente. Visor: permisos read seleccionados para módulos concretos; no incluir audit/documentos por defecto.
`catalogs.read/manage` se valida en el alcance del catálogo: global para miembros del tenant con el permiso; organización para asignaciones de organización; empresa para asignaciones de organización o de esa empresa. Una asignación solo de sucursal no se amplía al catálogo de toda la empresa.
Permiso files.download no concede acceso universal: debe cumplirse también la política del recurso asociado; documentos de empleados requieren employee_documents.read. employees.read expone lista laboral mínima; identificación personal, domicilio y fotos requieren además employees.personal.read. Consultar metadatos documentales requiere employee_documents.read y files.read; descargar bytes requiere también files.download. Los roles supervisor y visor no reciben employee_documents.* ni employees.personal.read por defecto.
En ADM-05, una asignación employees.update de sucursal permite cambiar solo la pertenencia del empleado a esa sucursal; no permite cambiar empresa, código, nombre, cargo, fecha, estado o datos personales del empleado. Esos campos compartidos requieren employees.update con alcance de empresa u organización. En asignaciones de sucursal solo se pueden agregar o quitar sucursales cuyo permiso efectivo cubra la acción; el servidor conserva las asignaciones no autorizadas.
Para roles personalizados, UI muestra permisos y alcance; backend impide escalada y roles asignados fuera de alcance propio. Roles inactivos no autorizan. Último administrador no puede quedar desactivado o sin acceso.
