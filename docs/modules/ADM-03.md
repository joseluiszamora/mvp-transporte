# ADM-03 — Autenticación
## Entidades
Session, RefreshToken, AccountToken.
## Reglas y alcance
Aplicar docs/security.md. Login/logout/refresh/me, recuperación/confirmación, activación y cambio contraseña. SMTP fallo no cambia estado transaccional; tokens no aparecen en respuesta de producción.
## Panel web
Login, activar cuenta, recuperar contraseña, sesión sustituida, selector de organización.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Probar expiración, rotación, replay, login concurrente, varias pestañas, revocación inmediata y anti-enumeración.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
