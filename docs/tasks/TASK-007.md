# TASK-007 — Catálogos
Estado: en desarrollo en `task/007-catalogos`. TASK-006 se integró en `main` mediante PR #19; su aceptación funcional sigue pendiente del propietario. Issue GitHub: [#7](https://github.com/joseluiszamora/mvp-transporte/issues/7).
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
ADM-10 globales protegidos y catálogos cliente; seeds de documentos/cargos.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Unicidad scope; desactivación conserva referencias; UI/API no cambian protegidos.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-007. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia de implementación (15/10/2026)
- Nueva migración `20261015000400_task_007_catalogs` crea `Catalog`/`CatalogItem`, restricciones de scope y FK compuesta a empresa; siembra catálogos globales protegidos de documentos y cargos con once opciones generales. No se aplicó a la base persistente local.
- API paginada de catálogos/opciones con lectura y gestión por permiso y alcance; globales protegidos solo lectura; catálogos de organización/empresa con baja lógica y auditoría. Códigos se normalizan a mayúsculas y las opciones de catálogo inactivo no se devuelven como activas.
- UI ADM-10 incluye filtros, estados, carga/error/vacío, catálogos y opciones, creación/edición/reactivación y marcas de protección. Pendiente prueba manual autenticada del propietario.
- Decisiones de alcance registradas en `docs/decisions.md`; sin soporte de catálogo por sucursal ni opciones específicas de transporte.
- Validación: `npm run lint`, `npm run typecheck`, `npm test` (7/7), `npm run build` y `npm run test:integration` pasaron. Integración usó PostgreSQL/Mailpit desechables y aplicó las cuatro migraciones; la prueba de UI manual y aceptación funcional permanecen pendientes.
- Build advierte que el bundle principal supera 500 kB (985.42 kB); no impidió el build.
