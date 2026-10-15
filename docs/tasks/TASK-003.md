# TASK-003 — Auditoría y correo mínimos
Estado: en revisión funcional tras validación técnica. Dependencias: 002. Issue GitHub: [#3](https://github.com/joseluiszamora/mvp-transporte/issues/3).
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Servicios audit append-only y outbox/worker con SMTP por entorno y buzón local para activar cuentas. Ampliaciones administrativas en tareas 010/012.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Rollback consistente; reintentos sanitizados; secretos ausentes; entrega local de mensaje.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-003. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia técnica local (15/10/2026)
- La integración desechable aplicó TASK-002 y TASK-003 sobre PostgreSQL 18, cargó fixtures aislados y entregó un correo SMTP real a Mailpit.
- Se verificaron rollback conjunto de cambio/auditoría/outbox, sanitización de before/after y errores, append-only (UPDATE/DELETE/TRUNCATE), cifrado del payload, deduplicación por evento, reintento y cierre de lease agotado.
- Las pantallas de historial/configuración y sus endpoints administrativos se mantienen en las tareas ADM-07/ADM-09 indicadas por el alcance aprobado; TASK-003 entrega servicios internos, migración, plantillas y worker.
- CI remota del PR aprobada; la aceptación funcional corresponde al propietario. No se aplicó la migración a una base persistente ni se desplegó producción.
