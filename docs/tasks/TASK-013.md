# TASK-013 — Consolidación y aceptación
Estado: pendiente. Dependencias: 012. Issue GitHub: no creada.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Tests end-to-end críticos, revisión seguridad, OpenAPI final, manual instalación, backup/restore BD+archivos y guía DigitalOcean sin desplegar.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Diez módulos revisables, checks CI verdes, restauración local probada, demo de escenarios docs/acceptance.md.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-013. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.
