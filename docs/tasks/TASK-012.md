# TASK-012 — Administración de correo
Estado: integrado en `main` por PR #27 (merge commit `dd0b20c458e952b5c0af50df65e2ebf2674f90be`); CI #41 aprobada. Dependencias: TASK-011 integrada y aceptada. Issue GitHub: [#12](https://github.com/joseluiszamora/mvp-transporte/issues/12) abierta; aceptación funcional pendiente.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Completar ADM-09 SMTP configurable seguro, templates, historial y prueba autorizada.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Config en UI sin devolver password; SMTP failure/retry; historial aislado; explicar posible duplicación SMTP tras crash.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-012. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.


## Validación y estado de entrega (25/10/2026)
- Validaciones locales registradas: `npm run lint` (77 archivos), `npm run typecheck`, `npm run test` (12/12), `npm run build`, `git diff --check` e `npm run test:integration` con PostgreSQL/Mailpit desechables. La integración aplicó ocho migraciones solo a la base efímera.
- El build advirtió que el bundle web de 735.73 kB supera el umbral informativo de 500 kB.
- PR #27 se integró en `main` (merge commit `dd0b20c458e952b5c0af50df65e2ebf2674f90be`). CI #41 aprobó lint, typecheck, unitarias, build e integración PostgreSQL desechable para el head integrado. Prueba manual de ADM-09 y aceptación funcional del propietario pendientes. Issue #12 permanece abierta.
- No se migró la base persistente local ni se desplegó producción.

## Ajuste de reintentos SMTP (25/10/2026)
- Hallazgo durante prueba manual: fallas de transporte agotaban los cinco intentos en unos 15 segundos, antes de que pudiera recuperarse Mailpit/SMTP.
- Cambio propuesto: conserva cinco intentos totales y amplía el backoff inicial predeterminado a 30 segundos con jitter; la ventana acumulada pasa a aproximadamente 5m37s–9m23s. El límite por demora sigue siendo una hora.
- Los mensajes ya agotados permanecen terminales para evitar reenviar enlaces posiblemente vencidos. La integración crea un evento nuevo, comprueba la programación del primer retry y valida que el máximo predeterminado siga en cinco intentos.
- Pendiente: validar en Mailpit una falla temporal seguida de recuperación y aceptación funcional del propietario. La Issue #12 permanece abierta.
