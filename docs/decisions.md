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
