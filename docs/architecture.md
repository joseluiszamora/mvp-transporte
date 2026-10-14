# Arquitectura
## Decisiones
Monolito modular. Express + TypeScript; PostgreSQL + Prisma; React + Vite + TypeScript como SPA; monorepo npm workspaces; Flutter posterior. Backend único dueño de autorización y reglas. React Router para navegación; elección de librería visual y consultas se documenta en TASK-001 sin alterar arquitectura. Instalar versiones estables compatibles y fijar lockfile; verificar documentación oficial antes de seleccionar versiones.
## Directorios
apps/api/src/modules/{organizations,companies,users,auth,access,employees,settings,audit,files,notifications,catalogs}
apps/api/prisma; apps/web/src/features; packages/contracts; docs.
contracts contiene esquemas/DTO públicos compartidos, nunca cliente Prisma ni secretos. API /api/v1 con OpenAPI; health y readiness sin información sensible.
## Multicliente
Organization=tenant=cliente. Organization tiene Company; Company tiene Branch. User global; OrganizationMembership vincula identidad a cliente. Accesos por role assignment tipado: toda organización, una empresa o una sucursal. Denegar por defecto. Una sucursal debe pertenecer a la empresa y tenant del recurso. Tener acceso a una empresa no concede otras.
Tenant seleccionado se valida contra membresía activa en cada solicitud. Los repositorios requieren contexto de acceso explícito. Las FKs/índices compuestos deben impedir vínculos cruzados. Una política compartida debe autorizar también listados, exportaciones futuras, agregaciones y descargas. No confiar en un middleware de rutas como única protección.
## Dependencias
Auth depende de usuarios/membresías/sesiones. Acceso depende de membresías y catálogo de permisos. Personal depende de empresas, sucursales y catálogos. Archivos depende de acceso y políticas de recursos. Notificaciones depende de usuarios, configuración y outbox; no altera el éxito de una transacción ya confirmada si SMTP falla. Auditoría se integra en transacciones relevantes.
## Operación
Docker Compose para PostgreSQL y buzón SMTP local; apps pueden ejecutarse con npm en host. Archivos en volumen persistente privado fuera de web pública. Worker separado del mismo backend, cola/outbox en PostgreSQL; no introducir Redis inicialmente. DigitalOcean futuro con HTTPS y proxy, API/web same-origin preferentemente.
