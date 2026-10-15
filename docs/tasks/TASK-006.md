# TASK-006 — Organizaciones empresas sucursales
Estado: integrada en `main` mediante PR #19; CI aprobada; aceptación funcional pendiente del propietario. Dependencias: 005. Issue GitHub: [#6](https://github.com/joseluiszamora/mvp-transporte/issues/6).
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Completar ADM-01 plataforma manual y CRUD cliente; selectors y estados; completar listado/gestión ADM-02.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Dos tenants aislados; empresa de tenant propio; sucursal code único; admin no altera estado global de usuario ajeno.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-006. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia de implementación (15/10/2026)
- `GET/POST /platform/organizations` agrega listado y búsqueda de tenants, y conserva la creación con administrador inicial; `PATCH /platform/organizations/{organizationId}` actualiza nombre y estado.
- ADM-01 incorpora CRUD con desactivación no destructiva, filtros, paginación y autorización por tenant/empresa/sucursal. Los códigos de sucursal se normalizan a mayúsculas y son únicos por empresa.
- ADM-02 puede suspender/reactivar membresías aceptadas sin cambiar el estado global de la cuenta. Se protege al último administrador y se auditan las mutaciones.
- No requiere migración: el esquema de TASK-002 ya contiene entidades, estados y restricciones necesarias.
- Validación local: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y `npm run test:integration` pasaron. La integración usó PostgreSQL/Mailpit desechables y probó aislamiento, alcance, unicidad, estados, auditoría y protección del último administrador.
- PR #19 integrado con merge commit `f2bf803746afd9158fdb5e3095512f576d94aeb1`; CI run #14 aprobó lint, typecheck, tests unitarios, build e integración PostgreSQL desechable.
- Pendiente: aceptación funcional del propietario. No se desplegó producción ni se migró una base persistente.
