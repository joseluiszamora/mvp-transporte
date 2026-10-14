# ADM-06 — Configuración
## Entidades
Setting, BusinessHour, NumberSequence.
## Reglas y alcance
Valores tipados con allowlist: idioma es, BOB, zona La Paz, nombre/logo/color, horarios, numeraciones. Resolver defaults instalación→organización→empresa→sucursal solo para keys con esos scopes. SMTP plataforma separado. Numeración atómica; no permitir edición retrospectiva de número emitido.
## Panel web
Formularios por ámbito, vista de valor efectivo, horarios, numeración.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Valores inválidos rechazados; dos empresas difieren; prueba de concurrencia de numeración sin duplicados; secretos nunca serializados.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
