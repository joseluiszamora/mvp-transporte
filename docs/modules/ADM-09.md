# ADM-09 — Notificaciones correo
## Entidades
EmailTemplate, EmailOutbox, EmailDelivery.
## Reglas y alcance
SMTP configurable por instalación: host/port/TLS/from/user/password protegida. Local buzón de pruebas. Templates: activación, recuperación, contraseña cambiada; configuración para avisos genéricos autorizados. Outbox transaccional; worker claim con lock, retry limitado y backoff; deduplicación por evento. Correo SMTP puede duplicarse si hay crash después del envío: no prometer exactly-once; documentar límite.
## Panel web
Configuración plataforma con contraseña oculta, prueba explícita a email elegido, historial tenant de resultado sanitizado.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Simular SMTP caído y recuperar; no bloquear CRUD; no duplicar outbox por mismo evento; secretos ausentes; activación/recuperación entregadas.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
