# ADM-02 — Usuarios
## Entidades
User, OrganizationMembership, AccountToken.
## Reglas y alcance
Admin registra email; si identidad existe, agregar membresía sin revelar datos ajenos ni cambiar contraseña global. Usuario acepta activación/vinculación mediante enlace; evitar incorporar silenciosamente una identidad existente a cliente sin aceptación. Estado global solo plataforma/usuario según política; administrador cliente gestiona estado de membresía.
El administrador del tenant puede suspender una membresía activa y reactivar una suspendida con `users.deactivate`/`users.update`. No puede cambiar el estado global de User. La última membresía administradora protegida no se puede suspender. Una membresía `INVITED` debe aceptar su invitación antes de que un administrador pueda cambiarla a suspendida; la aceptación sigue dependiendo del enlace de un solo uso.
## Panel web
Listado de membresías, alta, estado, asignaciones; perfil propio.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
`GET /api/v1/organizations/users` lista membresías paginadas; `POST /api/v1/organizations/users/invitations` invita; `PATCH /api/v1/organizations/users/{membershipId}` cambia solo el estado de la membresía actual. Contratos y errores están documentados en OpenAPI. No exponer ORM ni cambiar perfil o estado global; un ID fuera del tenant responde 404 y permiso insuficiente 403.
## Aceptación
Mismo correo no duplica User; baja en tenant A conserva B; admin cliente no altera perfil global ajeno ni bloquea todos sus accesos.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
