# TASK-004 — Autenticación y alta administrativa
Estado: en revisión técnica; aceptación funcional pendiente del propietario. Dependencias técnicas: TASK-003 integrado; issue GitHub [#4](https://github.com/joseluiszamora/mvp-transporte/issues/4) abierta.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
ADM-02/03 con bootstrap plataforma por comando seguro, alta tenant/admin mínima, activación, login, refresh, recuperación, logout y pantallas.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Una sesión global activa bajo concurrencia; rotación/replay; usuario multitenant; no filtrar email; validar login y activación con correo local.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-004. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia técnica local (15/10/2026)
- Backend/API: bootstrap seguro de administrador inicial; alta de organización con rol administrativo inicial; invitación y listado paginado de membresías; activación, login, refresh rotativo, selección multitenant, recuperación, logout y verificación de sesión/permiso en solicitudes.
- Web: login, aceptación de invitación/activación, recuperación, selector de organización, usuarios e invitaciones y alta de organización. Access token solo en memoria; Web Locks/BroadcastChannel coordinan refresh en navegadores compatibles.
- Seguridad: Argon2id; tokens de un solo uso almacenados como hash; cookie refresh HttpOnly, CSRF doble envío, CORS/Origin por allowlist y rate limit PostgreSQL; sin cuenta ni contraseña pública inicial.
- `npm run lint`: correcto, 0 diagnósticos.
- `npm run typecheck`: correcto (contracts, API y web).
- `npm test`: correcto, 7/7; requirió permiso para abrir el servidor HTTP local de prueba.
- `npm run build`: correcto; Vite mantiene advertencia informativa de chunk mayor a 500 kB.
- `npm run test:integration`: correcto; migró TASK-002/003/004 y sembró únicamente PostgreSQL desechable, comprobó concurrencia, rotación/replay, aislamiento y permisos tenant, invitaciones/activación, anti-enumeración, recuperación/revocación y SMTP real a Mailpit; Compose eliminó los contenedores al final.
- `npm audit --audit-level=high`: correcto, 0 vulnerabilidades.
- No se aplicaron migraciones a la base local persistente ni se desplegó producción. El propietario confirmó la aceptación funcional y cerró la issue #4; estado verificado en GitHub el 24/10/2026.
- 24/10/2026: corregida en `task/004-persistencia-tema-regresion` la pérdida de preferencia de tema al recargar, restaurando el valor `light`/`dark` desde `localStorage` y guardando cada cambio. Pasaron `npm run lint`, `npm run typecheck` y `npm run build`; la verificación de refresco por el propietario queda pendiente.
