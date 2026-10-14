# ADM-02 — Usuarios
## Entidades
User, OrganizationMembership, AccountToken.
## Reglas y alcance
Admin registra email; si identidad existe, agregar membresía sin revelar datos ajenos ni cambiar contraseña global. Usuario acepta activación/vinculación mediante enlace; evitar incorporar silenciosamente una identidad existente a cliente sin aceptación. Estado global solo plataforma/usuario según política; administrador cliente gestiona estado de membresía.
## Panel web
Listado de membresías, alta, estado, asignaciones; perfil propio.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Mismo correo no duplica User; baja en tenant A conserva B; admin cliente no altera perfil global ajeno ni bloquea todos sus accesos.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
