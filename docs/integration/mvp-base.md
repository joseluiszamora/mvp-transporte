# Integración con mvp-base

## Revisión fijada

El submódulo conserva el commit base `97c5840211e593a9fd91775fe30383a173feeb35` y contiene localmente el commit `928d535` de `task/016-employee-self-context`, autorizado para resolver la identidad móvil de TASK-005. TASK-016 añade `GET /api/v1/employees/me`; no está publicado ni integrado en `main`. El PR #37 integró TASK-015, equivalente a TASK-007 de Transporte, y fue aceptado por el propietario. La integración aporta autorización contextual para APIs de producto, registro de permisos, archivos externos privados y escritura de auditoría.

El contrato fue revisado en [la guía de APIs de producto de mvp-base](https://github.com/joseluiszamora/mvp-base/blob/97c5840211e593a9fd91775fe30383a173feeb35/docs/integration/product-apis.md). Transporte no importa código interno de Base, no lee su base de datos y no instala su workspace npm como dependencia.

## Servicios y credenciales

Cada producto corre como API independiente y conserva su propia base PostgreSQL. Transporte usa `mvp_transport_local` en el puerto local 5433; mvp-base mantiene su puerto y esquema existentes. La web de Transporte corre en `http://localhost:5174`, la API de Transporte en `http://localhost:4100`, y la API local de Base se configura con `MVP_BASE_API_URL` (por defecto `http://localhost:4000/api/v1`).

Configura una credencial aleatoria de al menos 32 caracteres como servicio `transport` en `MVP_INTEGRATION_SECRETS_JSON` de mvp-base y como `MVP_BASE_INTEGRATION_KEY` en el `.env` raíz de Transporte. La clave se envía solo desde la API de Transporte en `X-MVP-Integration-Key`; no se incluye en Vite, el navegador ni la app móvil. En mvp-base agrega `http://localhost:5174` a `WEB_ORIGINS` para permitir login, renovación y cierre de sesión desde la web de Transporte.

La web inicia sesión contra `/api/v1/auth/login` de mvp-base y recibe un access token, la organización seleccionada y un token CSRF. Conserva el access token solo en memoria; el refresh token permanece en la cookie HttpOnly de Base. La web conserva el valor CSRF en `sessionStorage` para renovar la sesión al recargar la página y envía `credentials: include` en las llamadas de autenticación. El cierre de sesión llama a `/api/v1/auth/logout` de Base.

TASK-016 de mvp-base aporta `GET /api/v1/employees/me` en el commit local `928d535`. La API de Transporte consume ese contrato en servidor y nunca acepta del móvil el `employeeId`. La app Flutter en `apps/mobile` incluye login, selección de organización, lista/detalle de viajes y acciones de inicio/fin; no puede arrancarse aún porque el SDK no generó los proyectos nativos ni se resolvieron paquetes. Configura en `WEB_ORIGINS` el valor enviado por `MVP_BASE_MOBILE_ORIGIN`.

## Operaciones usadas

| Uso | Contrato público de mvp-base | Comportamiento de Transporte |
|---|---|---|
| Registro de permisos | `PUT /api/v1/integrations/transport/registration` | La API registra de forma idempotente el manifiesto `transport.*` al arrancar. Envía solo la clave de servicio. |
| Autorización | `POST /api/v1/integrations/transport/authorize` | Cada lectura o escritura protegida envía Bearer, permiso exacto, empresa y sucursal opcional. Base vuelve a validar sesión, membresía y alcance. |
| Empresas y sucursales | `GET /api/v1/organizations/companies` y `/organizations/branches` | La API devuelve a la web las opciones del contexto autenticado. Base aplica sus reglas de acceso. |
| Personal | `GET /api/v1/employees?companyId=…` y `GET /api/v1/employees/{id}` | Los perfiles guardan solo `employeeId`. Antes de crear o reactivar, Transporte confirma que el empleado está activo y pertenece a la empresa. Estas rutas de Base requieren que el actor tenga `employees.read` además del permiso del producto. |
| Identidad propia del conductor | `GET /api/v1/employees/me` (TASK-016, rama local) | Solo el API de Transporte llama esta ruta con el Bearer del usuario; mvp-base deriva sesión, membresía y empleado activo. La app no envía identidad de empleado. Responde solo IDs mínimos y no concede acceso a transporte. |
| Viajes | `POST /api/v1/integrations/transport/authorize` y `POST /api/v1/integrations/transport/audit-events` | `transport.trips.*` protege lectura, planificación, asignación y transiciones; cada cambio conserva actor e historial en Transporte y se escribe en la auditoría común de Base. |
| Viajes propios móviles | `GET /api/v1/integrations/transport/authorize` | `transport.driver_trips.read` y `transport.driver_trips.transition` aplican permisos de empresa; Transporte filtra siempre por el perfil y las asignaciones activas del empleado resuelto por Base. Iniciar o completar también requiere `transport.audit.write`. |
| Auditoría | `POST /api/v1/integrations/transport/audit-events` | La API envía Bearer, acción, recurso y contexto derivado de su base. Base fija actor, organización e integración. Los usuarios que escriben también necesitan `transport.audit.write`. |
| Archivos privados | `POST/GET /api/v1/integrations/transport/files/{resourceType}/{resourceId}?companyId=…&branchId=…` | Transporte registra `VEHICLE` y `EMPLOYEE`, envía `multipart/form-data` con el campo `file` y guarda el `fileId` retornado como referencia externa. |
| Metadatos y descarga | `GET /api/v1/integrations/transport/files/{fileId}` y `GET /api/v1/integrations/transport/files/{fileId}/content` | El API valida otra vez la sesión y permisos del actor antes de consultar o entregar el contenido; el navegador nunca recibe una URL pública. |

La interfaz REST de Transporte empieza en `/api/v1/transport`: vehículos, personal operativo, viajes y asignaciones, consultas propias del conductor, documentos, mantenimiento, combustible, empresas, sucursales, health, readiness y OpenAPI. La API primero carga sus recursos operativos, toma organización/empresa/sucursal de esos registros y luego pide autorización a Base. Nunca usa un ID del navegador como evidencia de pertenencia.

## Límites y consistencia

- `mvp-base` es dueño de identidad, organizaciones, empresas, sucursales, empleados, permisos, archivos y auditoría.
- Transporte es dueño de vehículos y perfiles operativos. Sus tablas almacenan IDs Base como referencias externas sin claves foráneas entre bases.
- Las operaciones que escriben datos requieren que Base esté disponible y autorice la acción. La auditoría remota se solicita dentro de la transacción local antes del commit para cancelar la escritura si Base rechaza la auditoría. Como son dos bases independientes, si Base guarda la auditoría y luego falla el commit local, puede quedar un evento sin cambio local correspondiente; se registra el ID del recurso en el evento para facilitar reconciliación.
- Los registros de vehículo y perfil se desactivan con estado `INACTIVE`; el historial no se elimina físicamente.

## Instalación combinada local

1. Inicializa el submódulo y prepara los paquetes de ambos repositorios con `git submodule update --init --recursive`, `npm run setup:base` y `npm install` en la raíz de Transporte.
2. Copia `mvp-base/.env.example` a `mvp-base/.env` y `.env.example` a `.env` de Transporte. Configura la base independiente en `TRANSPORT_DATABASE_URL`.
3. Configura en `mvp-base/.env` su secreto `transport` y agrega `http://localhost:5174` a `WEB_ORIGINS`.
4. Levanta ambas bases: ejecuta el Compose de mvp-base según su README y luego `docker compose up -d` desde Transporte para iniciar su PostgreSQL en 5433.
5. Aplica migraciones con `npm run db:migrate:dev`; el comando ejecuta los scripts de Base y Transporte contra sus URLs respectivas. Usa `npm run db:generate` para generar ambos clientes.
6. Arranca en terminales separadas `npm run dev:base-api`, `npm run dev:base-web`, `npm run dev:api` y `npm run dev:web`.

Para una instalación nueva, el README raíz contiene la secuencia y los comandos existentes. No ejecutes las migraciones de un producto contra la base del otro.
