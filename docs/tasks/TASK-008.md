# TASK-008 — Configuración
Estado: implementada en `task/008-configuracion`; pendiente revisión técnica y aceptación funcional. Dependencias: TASK-007 integrada por PR #20. Issue GitHub: [#8](https://github.com/joseluiszamora/mvp-transporte/issues/8), abierta hasta aceptación del propietario.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
ADM-06 scopes/defaults, identidad, horario y numeraciones atómicas.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Dos empresas diferentes; keys tipadas; concurrencia sin números duplicados; tema claro/oscuro.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-008. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia técnica — 16/10/2026
- Criterios técnicos implementados: overrides de claves allowlisted e herencia por alcance, configuración independiente por empresa, horarios con validación de intervalos, numeración atómica y auditable, autorización por tenant/empresa/sucursal y controles de instalación solo para plataforma.
- Validaciones: `npm run lint`, `npm run typecheck`, `npm run test` (7/7), `npm run build` y `npm run test:integration` (PostgreSQL 18 y Mailpit desechables); todos finalizaron correctamente.
- La prueba de integración comprobó permisos limitados, aislamiento entre tenants/empresas/sucursales, valores inválidos, herencia y separación de horarios, 12 emisiones concurrentes sin duplicados, inmutabilidad después de emitir y ausencia de secretos SMTP en respuestas de instalación.
- La migración `20261016000100_task_008_settings` se aplicó únicamente en la base desechable de Compose. No se modificó la base persistente local ni se desplegó producción.
- Pendiente: revisión técnica del PR y prueba manual del propietario. Esta evidencia técnica no constituye aceptación funcional.
