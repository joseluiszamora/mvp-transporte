# TASK-011 — Consulta auditoría
Estado: en desarrollo. Dependencias: 010. Issue GitHub: #11 abierta.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Completar ADM-07 UI filtros/detalle, permisos lectura, eventos faltantes y retención.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Consulta filtrada por tenant/alcance; sin secretos ni edición; evidencia sobre módulos anteriores.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-011. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Avance técnico (18/10/2026)
- Implementado en código: endpoints GET de lista y detalle, filtrado por tenant y `audit.read`, paginación, sanitización de diferencias y panel web ADM-07. Sin migración de datos.
- Pruebas de integración implementadas para dos tenants y alcances de sucursal, usuario sin permiso, filtros, detalle, sanitización histórica y lectura/escritura sin edición. La ejecución local está bloqueada por el daemon Docker ausente.
- Pendiente de decisión del propietario: retención/purga (ADM-07 propone 365 días; decisions.md no aprueba mínimo) y visibilidad de eventos de empleado para auditoría limitada a sucursal.
- La Issue #11 permanece abierta. No declarar la tarea aceptada hasta completar decisiones, validación técnica y aceptación funcional.
### Validación local (18/10/2026)
- `npm run lint`: pasó sin advertencias.
- `npm run typecheck`: pasó para contracts, API y web.
- `npm run test`: pasó, 9/9.
- `npm run build`: pasó; Vite informó un bundle web de 723.45 kB, sobre el umbral de 500 kB.
- `npm run test:integration`: no ejecutó pruebas porque Docker no pudo abrir `npipe:////./pipe/dockerDesktopLinuxEngine`; los servicios desechables no iniciaron. No se usó la base persistente local.
- Pendientes: integración CI de esta rama, prueba manual de UI, decisiones de retención y de visibilidad de eventos de empleado por sucursal, y aceptación funcional del propietario.