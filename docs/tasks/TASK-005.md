# TASK-005 — Roles y alcances
Estado: implementación técnica en `task/005-roles-alcances`; aceptación funcional pendiente del propietario. Dependencias: 004. Issue GitHub: [#5](https://github.com/joseluiszamora/mvp-transporte/issues/5).
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
ADM-04 catálogo permisos, roles seed, scopes, editor y asignación; aplicar políticas en endpoints existentes.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Backend bloquea escalada; último admin protegido; membresía desactivada sin acceso; matriz con tenant/empresa/sucursal.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-005. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Implementación técnica
- Se usa el esquema y catálogo de permisos ya creados por TASK-002; no requiere una migración adicional. Los endpoints de roles y asignaciones comprueban tenant y scope en PostgreSQL, limitan permisos concedibles, auditan cambios y protegen al último administrador.
- ADM-04 incorpora catálogo de permisos, edición/desactivación de roles y asignaciones de membresía con alcance de organización, empresa o sucursal. La autorización del servidor no depende de la visibilidad de controles web.
- La validación de acceso se repite desde la base de datos en cada solicitud; suspender una membresía o cambiar un rol revoca el permiso de inmediato.
- Evidencia técnica local: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y `npm run test:integration`. Esta última usa PostgreSQL y Mailpit desechables. Aceptación y prueba manual funcional del propietario siguen pendientes.
