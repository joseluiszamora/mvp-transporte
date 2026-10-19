# Seguridad y sesiones
## Política acordada
Correo y contraseña; admin crea usuarios; sin registro público, Google o 2FA. Activación mediante enlace de un solo uso para establecer contraseña; admin no recibe contraseña final. Respuesta genérica en recuperación para evitar enumeración. Normalizar correo y aplicar unicidad global. Contraseña mínimo 12 caracteres, admitir gestores y evitar truncado silencioso. Hash resistente apropiado, parámetros documentados al implementar; rate limit en login/recuperación/activación.
Access token 15 minutos; refresh token con vencimiento absoluto 7 días desde login. Rotar en cada renovación, conservar solo hash. Session única activa por User global. Nuevo login revoca anterior atómicamente incluso con solicitudes concurrentes. Cambiar o recuperar contraseña revoca todas las sesiones. Logout revoca; bloqueo global también.
En cada solicitud verificar session_id activa, usuario y membresía activos; revocación inmediata. Cambio de permisos se aplica en siguiente solicitud, no esperar expiración JWT. Cambio de organización conserva la misma sesión y valida acceso. Desactivar membresía afecta solo esa organización.
Refresh en cookie HttpOnly; Secure en producción; SameSite apropiado; CSRF y comprobación de origen en rutas con cookie; CORS por allowlist, nunca wildcard con credenciales. Access en memoria, no localStorage. Varias pestañas comparten una sesión: implementar coordinación/single-flight de renovación para que carreras legítimas no parezcan reutilización maliciosa. Reutilizar refresh consumido fuera del manejo de concurrencia definido revoca la familia y obliga login.
## Alcance
Una sesión activa no demuestra identidad física del dispositivo. Otro navegador/login sustituye anterior. El administrador de plataforma no obtiene acceso automático a archivos de clientes; cualquier acceso excepcional debe definirse y auditarse, no agregarse por conveniencia.
## Datos
No incluir contraseñas/tokens/secrets en logs o auditoría. SMTP secreto solo por backend, cifrado en BD con clave externa al repositorio o mediante referencia segura de entorno; respuesta de configuración oculta credencial. El frontend nunca recibe contraseña SMTP. No permitir rutas arbitrarias de archivos, HTML inseguro ni adjuntos públicos por defecto.
Tokens activación y recuperación: aleatorios fuertes, hash almacenado, un solo uso; propuesta inicial activación 24h, recuperación 30min, configurable con límites seguros. No permitir que un administrador asigne privilegios fuera de su propio alcance ni retire al último administrador de una organización activa.

## Roles y asignaciones (TASK-005)

- El catálogo de permisos es global e inmutable; los roles editables pertenecen a un solo tenant. Los roles de tenant no pueden contener permisos `organizations.*`.
- Crear o editar roles exige permiso `roles.create` o `roles.update` a nivel de organización. Cada permiso propuesto debe estar dentro de los permisos efectivos del actor en ese tenant.
- Una asignación verifica en PostgreSQL la membresía, rol, empresa y sucursal activos y del mismo tenant. El actor debe tener `roles.assign` y todos los permisos del rol en el alcance solicitado; un alcance de sucursal no se amplía a otra sucursal ni a toda la empresa.
- Cambios de rol o asignación se serializan por tenant dentro de una transacción y se auditan. La autorización vuelve a leer membresía, estado de rol y permisos en cada solicitud; cambios y suspensiones se aplican de inmediato.
- El tenant debe conservar al menos una membresía activa de usuario activo con un rol activo asignado a nivel de organización que contenga todo el catálogo de permisos de cliente. Editar esos permisos, desactivar el rol o retirar la asignación que quitaría al último administrador se rechaza dentro de la misma transacción.

## Catálogos (TASK-007)

- Catálogos y opciones de organización/empresa se filtran por la membresía seleccionada y por el alcance exacto de `catalogs.read/manage`. No se confía en IDs de empresa recibidos del navegador.
- Catálogos globales están protegidos y son de solo lectura para clientes; se muestran solo con `catalogs.read` en la organización actual. Un permiso acotado a empresa o sucursal no se amplía a otra empresa.
- Desactivar es una baja lógica. Los módulos consumidores deben seleccionar solo opciones activas de catálogos activos; las referencias históricas conservan el ID y no se borran en cascada.

## Archivos privados (TASK-009)

- El driver local escribe fuera del directorio estático web. Los nombres originales solo son metadatos; las rutas usan claves UUID aleatorias y el cliente no puede elegir rutas ni tipos de recurso.
- La lista de destinos contiene únicamente empresas/sucursales del tenant seleccionado. Adjuntos de empresa requieren `files.*` y el permiso `companies.*` correspondiente; adjuntos de sucursal requieren `files.*` y `branches.*` sobre esa sucursal. La API vuelve a cargar el recurso y recalcula permisos para cada consulta, carga, descarga y eliminación.
- La carga valida un único campo `file`, extensión, MIME declarado y firma del contenido; admite PDF/JPEG/PNG/WEBP hasta 10 MiB. Los archivos servidos se transmiten solo tras autorización y usan `nosniff`, CSP restrictiva, descarga forzada y `no-store`.
- Los enlaces tienen tipos explícitos para empresas y sucursales; un UUID arbitrario o `EMPLOYEE_DOCUMENT` no se acepta. Los documentos personales quedan inaccesibles hasta que ADM-05 registre su política y los permisos de documentos. La migración vincula file, tenant, empresa y sucursal con claves foráneas y trigger de consistencia.
- La eliminación lógica quita el enlace y conserva bytes por 24 horas; la purga elimina solo filas pendientes sin enlaces vencidas, registra auditoría como `SYSTEM` y no borra archivos físicos con metadatos o enlaces vigentes. Los temporales y archivos sin metadatos se eliminan después del mismo periodo.

## Implementación de TASK-004 (15/10/2026)

- Las contraseñas se derivan con Argon2id (`memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1`); también se verifica una contraseña ficticia para aproximar el costo de un login con correo inexistente. El límite es 12 caracteres Unicode y 1024 bytes UTF-8.
- Access JWT HS256 exige una clave Base64 canónica de 32 bytes, issuer y audience definidos; dura 15 minutos o hasta el vencimiento anterior de la sesión. Refresh, activación y recuperación usan 32 bytes aleatorios opacos; PostgreSQL solo conserva SHA-256, vence a los 7 días absolutos, rota en cada refresh y un replay fuera de la rotación revoca la sesión.
- Login bloquea la fila de usuario dentro de una transacción antes de revocar e insertar sesión; el índice único parcial de sesión activa protege también la carrera. Cada request autenticada verifica sesión, estado global, membresía seleccionada y permisos vigentes en PostgreSQL.
- El refresh viaja únicamente en cookie HttpOnly; la cookie CSRF usa doble envío y comparación en tiempo constante. Login, refresh, logout, recuperación y activación comprueban `Origin`; CORS usa la allowlist exacta y credenciales. En producción las cookies se marcan `Secure` y `PUBLIC_WEB_URL` debe usar HTTPS.
- El cliente guarda el access token en memoria, coordina refresh dentro de la pestaña y usa Web Locks entre pestañas cuando el navegador expone esa API; BroadcastChannel distribuye la sesión renovada. El soporte funcional de navegadores sin Web Locks debe comprobarse antes de declararlo compatible.
- El rate limit persiste contadores por operación, IP e identidad mediante hashes en `auth_rate_limits`, con ventanas específicas para login, refresh, activación y recuperación. La IP es el peer directo de la conexión; no se confía en `X-Forwarded-For` sin una política de proxy explícita.
- Invitar a una identidad existente crea solo una membresía invitada; su aceptación requiere el enlace enviado y no cambia nombre ni contraseña global. La recuperación entrega la misma respuesta HTTP para correos conocidos y desconocidos. El primer administrador se crea con `npm run bootstrap:platform-admin` y activa su propia contraseña por correo.

La integración desechable cubre concurrencia, refresh/replay, aislamiento entre tenants, permisos, invitaciones/activación, anti-enumeración, recuperación, revocación y entrega a Mailpit. La navegación visual y la coordinación con varias pestañas quedan pendientes de prueba manual del propietario; no son aceptación funcional automática.

## Implementación de TASK-006

- Las rutas de empresas y sucursales toman el tenant de la membresía seleccionada en la sesión. Cada ID se vuelve a cargar dentro de ese tenant antes de autorizar; los listados filtran cada fila por su permiso y alcance antes de calcular el total y paginar.
- Crear empresa exige permiso a nivel de organización; crear sucursal exige permiso en la empresa activa. Editar y desactivar cargan primero el recurso y autorizan contra empresa/sucursal propia. Los tenants suspendidos no aceptan escrituras; una empresa inactiva bloquea mutaciones de sus sucursales.
- Suspender/reactivar ADM-02 altera solo `OrganizationMembership`, se serializa con las mutaciones de roles del tenant y se audita. No escribe `User.status`; se rechaza la suspensión si deja al tenant sin una membresía administradora activa.
- La activación de tenants requiere rol de plataforma. Suspender un tenant bloquea el acceso de sus membresías en la siguiente solicitud; activarlo de nuevo usa `organizations.activate`. Los cambios de estado y datos se auditan.
