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
