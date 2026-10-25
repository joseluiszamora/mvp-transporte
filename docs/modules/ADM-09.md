# ADM-09 — Notificaciones correo
## Entidades
EmailTemplate, EmailOutbox, EmailDelivery.
## Reglas y alcance
SMTP configurable por instalación: host/port/TLS/from/user/password protegida. Local buzón de pruebas. Templates: activación, recuperación, contraseña cambiada; configuración para avisos genéricos autorizados. Outbox transaccional; worker claim con lock, cinco intentos totales y backoff exponencial con jitter desde 30 segundos (máximo 1 hora por demora); deduplicación por evento. La ventana automática es de aproximadamente 5m37s–9m23s. Correos que agotaron los intentos quedan terminales; activación o recuperación requiere generar un evento nuevo. Correo SMTP puede duplicarse si hay crash después del envío: no prometer exactly-once; documentar límite.

La contraseña SMTP persistida se cifra con AES-256-GCM y `SMTP_SETTINGS_ENCRYPTION_KEY`, clave Base64 canónica de 32 bytes independiente de `EMAIL_PAYLOAD_ENCRYPTION_KEY`. La UI nunca la devuelve; un campo vacío conserva la actual y quitar credenciales exige una acción explícita. La configuración guardada en la base prevalece sobre SMTP de entorno. Si no existe configuración de base, el worker conserva la compatibilidad con variables de entorno.

Las plantillas transaccionales actuales son de sistema y se administran mediante código/migraciones; el panel permite consultarlas. En esta tarea no se agrega un editor de HTML ni envío libre de mensajes.
## Panel web
Configuración plataforma con contraseña oculta, prueba explícita a email elegido, historial tenant de resultado sanitizado.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.

La prueba SMTP solo la ejecuta `PLATFORM_ADMIN`; su auditoría registra éxito o fallo sin guardar el correo de destino ni credenciales. El historial tenant solo admite `notifications.read` con asignación `ORGANIZATION`; alcance de empresa/sucursal no concede acceso porque `EmailOutbox` solo guarda `organization_id`. No devuelve destinatario, cuerpo ni payload.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Simular SMTP caído y recuperar; no bloquear CRUD; no duplicar outbox por mismo evento; secretos ausentes; activación/recuperación entregadas.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
