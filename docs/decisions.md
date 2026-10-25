# Decisiones
Aprobadas por el propietario en conversación del 14/10/2026:
- Base independiente; diez módulos antes de distribución; backend y web primero.
- Express TS, PostgreSQL, Prisma; React Vite TS recomendado y aceptado; Flutter posterior.
- Inicio desde cero; GitHub joseluiszamora/mvp-transporte; monorepo; local y DigitalOcean futuro.
- Cliente con varias empresas; usuario multiorganización; alcance por empresas/sucursales.
- Alta y activación manual; sin suscripciones iniciales.
- Correo/contraseña, admin incorpora usuarios; roles admin/supervisor/operador/visor; sin 2FA.
- Access 15min, refresh 7 días absolutos, rotación, una sesión global activa.
- Empleados sin cuenta; visor requiere cuenta; supervisor ve datos laborales y documentos requieren permiso específico.
- Bolivia, español, BOB, America/La_Paz; identidad por empresa.
- Archivos privados en servidor; SMTP configurable; solo correo.
- Instalaciones y bases independientes por producto futuro.
- Codex implementa e integra tareas acordadas; GitHub Issues; propietario solo con una semana disponible para revisar/probar.

## Convenciones de implementación propuestas en este paquete
npm workspaces, API /api/v1, activación 24h/recuperación 30min, máximo inicial archivo 10MiB, outbox PostgreSQL, SMTP por instalación. Codex puede ajustar detalles menores con justificación y documentación; no tratar estas propuestas como requisitos expresamente dictados por el propietario.

## Registro de nuevos cambios
Fecha | decisión | motivo | alternativas | impacto | estado/proponente.
No cambiar silenciosamente una decisión aprobada. No fijar dependencias a versiones recordadas sin comprobar compatibilidad.

## Implementación de TASK-001
- 14/10/2026: shell web con MUI 9 + Emotion, React Router 7 y TanStack Query 5. MUI resuelve componentes y tema; React Router cubre la SPA prevista; TanStack Query gestiona estados de consulta API. Aplicación: shell base; no introduce permisos ni datos de negocio.
- 14/10/2026: runtime Node 24 LTS, npm 11, Express 5, React 19 y Vite 8; versiones exactas guardadas en `package-lock.json`. Las versiones se comprobaron al implementar y compilar.
- 14/10/2026: readiness consulta PostgreSQL mediante `pg` con `SELECT 1`, responde 503 sin detalles ante fallos. Prisma, modelo y migraciones siguen reservados para TASK-002.
- 14/10/2026: `test:integration` inicia PostgreSQL 18 en almacenamiento temporal `tmpfs` con un proyecto Compose aislado y lo elimina al finalizar; no usa una URL configurada por el usuario.
- 14/10/2026: la API inicia aunque `DATABASE_URL` no esté configurada; `/health` informa liveness y `/ready` responde 503 sin detalles. Esto permite levantar y revisar el shell antes de habilitar PostgreSQL.
- 15/10/2026: TASK-002 usa Prisma ORM 7.10.0, versión estable de la línea 7; Prisma 8 seguía como release candidate en la comprobación del 08/10/2026. La línea 7 continúa soportada. Se habilita `partialIndexes` (preview en Prisma 7) para que el índice parcial de sesión permanezca representado en el schema y migraciones. Fuentes: [estado de releases](https://www.prisma.io/docs/orm/release-status), [índices Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes). Requiere que TASK-004 revoque la sesión no revocada anterior dentro de la transacción de login antes de insertar la nueva; el índice protege también ante carreras.
- 15/10/2026: las invariantes que Prisma Schema Language no expresa (shape del scope, password requerido para usuario activo y consistencia del contexto de auditoría) se mantienen como `CHECK` SQL en la migración generada desde el schema. Las asociaciones entre tenant/empresa/sucursal usan claves foráneas compuestas.
- 15/10/2026: fixtures de seed locales usan usuarios sin contraseña y pendientes de activación; el comando rechaza hosts que no sean locales y entornos que no sean desarrollo o prueba. Esto evita crear cuentas iniciales con contraseña pública fija.
- 15/10/2026: el CLI Prisma 7.10.0 declara dependencias transitivas afectadas por advisories. Se fijan `deepmerge-ts` 8.0.2 y `mysql2` 3.24.6 mediante dependencias de desarrollo y overrides comprobados con `npm audit` (cero vulnerabilidades), `prisma validate` y `prisma generate`. Implementación técnica pendiente de revisión del propietario.

## Implementación de TASK-003
- 15/10/2026: el payload del outbox se cifra con AES-256-GCM usando una clave base64 de 32 bytes entregada por `EMAIL_PAYLOAD_ENCRYPTION_KEY`. Esto permite encolar enlaces de un solo uso sin persistirlos en texto claro; la clave queda fuera de Git y debe administrarse como secreto del entorno.
- 15/10/2026: las plantillas de activación, recuperación y cambio de contraseña se crean con migración y solo aceptan las variables declaradas. En esta tarea son mensajes de texto; la edición administrativa queda para tareas posteriores.
- 15/10/2026: TASK-003 usa Nodemailer 10.1.1 con tipos incluidos; su release oficial indica compatibilidad con Node.js 20 o posterior, compatible con Node 24 del repositorio. Se usa SMTP estándar y Mailpit local. Fuentes: [paquete oficial en npm](https://www.npmjs.com/package/nodemailer), [documentación SMTP](https://nodemailer.com/smtp), [envío SMTP local de Mailpit](https://mailpit.axllent.org/docs/usage/sending-messages/).
- 15/10/2026: el worker reclama outbox con `FOR UPDATE SKIP LOCKED`, lease y reintentos limitados. La entrega es al menos una vez; un fallo entre aceptación SMTP y confirmación PostgreSQL puede duplicar un mensaje.
- 15/10/2026: si un lease expira después del último intento, el worker registra `DELIVERY_OUTCOME_UNKNOWN` y deja el mensaje en estado final `FAILED`; no reenvía automáticamente porque SMTP pudo aceptar el mensaje antes de caer el proceso.
- 15/10/2026: `audit_events` declara actor `USER` o `SYSTEM`; un trigger rechaza update, delete y truncate. No se añade purga en TASK-003 porque el mínimo de retención no está aprobado; la política de purga requiere una tarea posterior.

## Implementación de TASK-004

- 15/10/2026: hashing con Argon2id (`m=19456 KiB`, `t=2`, `p=1`) y token access HS256 firmado con una clave Base64 canónica de 32 bytes. Se eligen parámetros conservadores para esta base inicial; los enlaces opacos de sesión/activación/recuperación se persisten como SHA-256.
- 15/10/2026: los límites de intentos viven en PostgreSQL con claves hash de operación, IP e identidad; así sobreviven reinicios y comparten conteo entre procesos sin almacenar correos/IP en claro. Se limpia una muestra de contadores antiguos durante solicitudes.
- 15/10/2026: refresh exige cookie doble `HttpOnly` + token CSRF legible y header coincidente, además de `Origin` exacto; CORS de credenciales queda limitado a `WEB_ORIGINS`. La cookie usa `SameSite=Lax`, `Secure` cuando `NODE_ENV=production` y path de autenticación.
- 15/10/2026: aceptación de una invitación para una identidad existente requiere activación explícita del enlace. La operación solo crea la membresía y no sobrescribe perfil/contraseña global; la clave foránea compuesta vincula el `AccountToken` a la membresía de ese mismo usuario.
- 15/10/2026: no se crea usuario plataforma predefinido ni se muestra una contraseña/token en consola. El administrador inicial se crea mediante CLI con confirmación escrita y completa su acceso con el enlace encolado por el outbox.
- 15/10/2026: el cliente conserva access en memoria y usa `navigator.locks` para serializar refresh entre pestañas compatibles, con `BroadcastChannel` para compartir la sesión rotada; no se guarda el token en `localStorage`. La compatibilidad cross-tab en navegadores sin Web Locks queda como verificación manual previa a declarar soporte.

## Implementación de TASK-005
- 15/10/2026: los roles de tenant nunca pueden incluir `organizations.*`; los permisos provienen del catálogo inmutable. Crear/editar roles requiere alcance de organización y limita la nueva lista de permisos al conjunto efectivo del actor. Las asignaciones admiten los tres scopes existentes y validan el actor contra cada permiso del rol en el destino cargado desde PostgreSQL.
- 15/10/2026: se define “último administrador” como una membresía y usuario activos con un rol activo asignado a nivel `ORGANIZATION` que contiene todos los permisos de cliente. Mutaciones de roles se serializan con un advisory lock transaccional por tenant y verifican que quede un administrador antes de confirmar; las mismas transacciones guardan auditoría.
- 15/10/2026: el acceso vuelve a resolver membresía, estado de rol y permisos desde PostgreSQL por solicitud, de modo que desactivar una membresía/rol o cambiar una asignación no depende de esperar el vencimiento del JWT.

## Implementación de TASK-006

- 15/10/2026: los códigos de sucursal se recortan y pasan a mayúsculas; la comparación de duplicados es insensible a mayúsculas y limitada a la empresa. La serialización de escrituras por la fila de empresa y la normalización preservan la unicidad sin migración. El mismo código puede existir en empresas diferentes.
- 15/10/2026: empresas y sucursales conservan filas históricas al desactivarse. `companies.update`/`branches.update` autorizan reactivación, mientras `companies.deactivate`/`branches.deactivate` autorizan desactivación; una empresa inactiva impide escribir en sus sucursales.
- 15/10/2026: ADM-02 permite suspender solo membresías aceptadas; las invitaciones se controlan con su enlace de un solo uso. Suspender/reactivar nunca cambia el User global y usa el mismo advisory lock de gestión de roles para proteger la regla del último administrador.
- 15/10/2026: no se añade migración; TASK-002 ya representa organización, empresa, sucursal, estados, unicidad y claves foráneas compuestas. La integración aplica solo esas migraciones existentes a una base desechable.
- 15/10/2026: TASK-006 se integró en `main` por PR #19 con CI #14 aprobada. Issue #6 permanece abierta hasta aceptación funcional.

## Implementación de TASK-007

- 15/10/2026: los catálogos tienen alcances `GLOBAL`, `ORGANIZATION` y `COMPANY`. Los globales son protegidos y de solo lectura para clientes; la gestión de catálogos propios exige `catalogs.manage` en el mismo alcance. Los permisos de sucursal no se amplían a una empresa porque el catálogo no tiene alcance sucursal.
- 15/10/2026: la migración crea catálogos globales protegidos de tipos de documento y cargos con opciones generales, no específicas de transporte. La organización o empresa puede crear catálogos propios incluso con el mismo código porque la unicidad es por scope; las opciones son únicas dentro de su catálogo.
- 15/10/2026: los códigos se normalizan a mayúsculas y el código de catálogo es inmutable tras crearlo; las bajas son lógicas y conservan IDs para referencias. Una opción no se ofrece para nuevos registros si el catálogo padre está inactivo. La migración y el seed se validan en la base desechable; no se modifica la base persistente local.

## Implementación de TASK-008

- 16/10/2026: los horarios usan días ISO (lunes=1 a domingo=7), hasta dos intervalos locales por día, sin cruce de medianoche ni solapamiento. Un horario de sucursal reemplaza la semana completa; mientras no exista, se hereda el de la empresa.
- 16/10/2026: cada numeración se define por alcance, tipo documental y período `ALL`, `AAAA` o `AAAA-MM`; el período forma parte del número emitido y de la clave única. El rollover es explícito: se crea una numeración para el nuevo período, sin reinicio automático.
- 16/10/2026: la identidad de empresa admite nombre, color hexadecimal y URL HTTPS sin credenciales, query ni fragmento. El servidor almacena la URL como dato y no descarga ni procesa el recurso.
- 16/10/2026: los defaults de instalación se limitan a español, BOB y `America/La_Paz`; solo `PLATFORM_ADMIN` puede consultarlos o modificarlos. SMTP permanece en el módulo de correo y sus secretos no forman parte de `Setting`.

## Implementación de TASK-009
- 18/10/2026: el driver local guarda bytes bajo `FILE_STORAGE_PATH`, fuera de recursos estáticos; el despliegue local debe montar y respaldar ese volumen privado junto con PostgreSQL. Las claves de almacenamiento son UUID aleatorias; el nombre original se conserva solo como metadato.
- 18/10/2026: los tipos registrados son `COMPANY_ATTACHMENT` y `BRANCH_ATTACHMENT`. Cada operación exige el permiso `files.*` aplicable además de `companies.*` o `branches.*` en el recurso recargado desde la base; ni un UUID ni un permiso genérico amplían el alcance.
- 18/10/2026: los documentos de empleados quedan fuera del registro de enlaces hasta que ADM-05 cree el recurso y concrete su autorización. Rechazarlos ahora preserva el acceso personal restringido definido por seguridad sin adelantar el modelo de personal.
- 18/10/2026: en ADM-05, el permiso de actualización limitado a sucursal permite modificar solo la asignación de ese empleado a sucursales autorizadas. Los campos laborales compartidos y datos personales se editan con alcance de empresa u organización; al guardar, las asignaciones fuera del alcance del actor se conservan. Así se evita que un supervisor de una sucursal altere datos que afectan a las demás.
- 18/10/2026: se permite PDF/JPEG/PNG/WEBP hasta 10 MiB y solo si coinciden extensión, MIME declarado y firma. Quitar un archivo desvincula y marca purga con 24 horas de gracia; el CLI de limpieza purga solo filas vencidas sin enlaces y bytes huérfanos/temporales vencidos, con evento de auditoría.

## Implementación de TASK-010
- 18/10/2026: los empleados pueden existir sin usuario; un vínculo opcional acepta solo miembros de la misma organización y no concede permisos de aplicación. El detalle de la cuenta requiere además `users.read`.
- 18/10/2026: la lista devuelve solo información laboral. Identificación, contacto, fotos y documentos se sirven según permisos personales/documentales y de archivos; supervisor y visor permanecen sin esos permisos por defecto.
- 18/10/2026: el grant de sucursal solo modifica asignaciones permitidas; campos compartidos del empleado requieren `employees.update` de empresa u organización. Se conservan asignaciones fuera del alcance del actor.
- 18/10/2026: foto y documentos se guardan en el volumen privado existente; los tipos documentales y cargos deben pertenecer a catálogos activos y disponibles para la empresa. La prueba de integración requiere recursos Docker desechables; la base persistente local no se usa.
## Implementación de TASK-011
- 18/10/2026: la consulta de auditoría usa endpoints de lista paginada y detalle, solo GET, filtrados por tenant y por los grants efectivos `audit.read`. Las sucursales se registran directamente en `branch_id` cuando la mutación corresponde a una sucursal; los eventos de sucursal ya existentes también pueden resolverse por su recurso. La creación de empresa y las asignaciones de rol guardan su empresa/sucursal en columnas; la lectura admite los diffs históricos que no tenían ese contexto.
- 18/10/2026: la sanitización se aplica al guardar y al devolver el detalle para proteger también filas históricas. No se exponen diffs en el listado.
- 19/10/2026: el propietario aprueba conservar todos los eventos de auditoría, sin purga ni retención automática.
- 19/10/2026: el auditor con permiso limitado a una sucursal puede consultar eventos de empleados asignados actualmente a esa sucursal. La visibilidad del historial cambia según la asignación vigente; los eventos no tienen una sucursal histórica implícita.

## Implementación de TASK-012
- 19/10/2026: SMTP es configuración singleton por instalación; una fila persistida prevalece sobre variables de entorno. `SMTP_SETTINGS_ENCRYPTION_KEY` cifra la contraseña con AES-256-GCM y debe ser una clave externa e independiente de `EMAIL_PAYLOAD_ENCRYPTION_KEY`. Solo `PLATFORM_ADMIN` puede consultar, modificar y probar SMTP.
- 19/10/2026: el historial de correo exige `notifications.read` asignado a nivel de organización. Se rechazan grants limitados a empresa o sucursal porque `EmailOutbox` no registra ese alcance; la consulta usa la organización activa de sesión y no recibe IDs de tenant del navegador.
- 19/10/2026: la prueba SMTP registra en auditoría solo su resultado; no conserva destinatario ni credenciales. Las plantillas transaccionales existentes siguen siendo código/migración administrados y de solo lectura desde la UI. Se mantiene la entrega al menos una vez; un crash tras aceptación SMTP puede duplicar el mensaje.
- 25/10/2026: tras una falla de SMTP, el outbox conserva cinco intentos totales y usa backoff exponencial con jitter desde 30 segundos (hasta 1 hora por intento). Esto amplía la ventana automática a aproximadamente 5m37s–9m23s, incluyendo el primer intento. Los mensajes que ya agotaron intentos quedan terminales; para activar o recuperar una cuenta se debe generar un evento nuevo. Un lease expirado tras el último intento sigue como `DELIVERY_OUTCOME_UNKNOWN` y no se reenvía automáticamente.
