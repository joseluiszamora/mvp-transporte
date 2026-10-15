# TASK-001 — Fundamentos
Estado: aceptación funcional recibida del propietario (14/10/2026); revisión técnica e integración pendientes. Dependencias: —. Issue GitHub: [#1](https://github.com/joseluiszamora/mvp-transporte/issues/1).
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
Crear monorepo, API mínima, web shell, Compose PostgreSQL/SMTP local, env example, lint/typecheck/tests/build y CI GitHub Actions.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Arranque limpio reproducible; checks reales; health/readiness; ninguna credencial en git.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-001. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Avance local (14/10/2026)
- Creado el monorepo npm con `apps/api`, `apps/web` y `packages/contracts`, lockfile y comandos raíz de lint, typecheck, test, build e integración.
- La API expone health, readiness con `SELECT 1` y OpenAPI; la readiness oculta errores internos.
- La API puede iniciar sin `DATABASE_URL`; health sigue disponible y readiness informa que PostgreSQL no está listo.
- El shell web muestra los diez módulos como pendientes, ofrece navegación responsive y tema claro/oscuro; consulta el estado de API y base de datos sin simular autenticación.
- Compose incluye PostgreSQL y Mailpit; la integración usa un PostgreSQL temporal en `tmpfs`. README y CI quedaron añadidos.
- Librerías elegidas para la interfaz: MUI 9 con Emotion; navegación con React Router 7; consultas con TanStack Query 5. Sus versiones exactas están fijadas en los manifiestos y `package-lock.json`.

### Validación ejecutada
- `npm run lint`: correcto.
- `npm run typecheck`: correcto.
- `npm test`: correcto, 3 pruebas unitarias.
- `npm run build`: correcto; Vite advierte que el bundle principal supera 500 kB minificado.
- Conexión local configurada en `.env` (ignorado por Git): health 200 y readiness 200 (`SELECT 1`). Una consulta `READ ONLY` confirmó `localhost:5432/mvp_backend` y que aún no existe `public._prisma_migrations`.
- Migraciones: no hay esquema Prisma ni archivos/comandos de migración en TASK-001. Según `docs/decisions.md` y README, el modelo y las migraciones iniciales corresponden a TASK-002; no se aplicaron cambios de esquema a `mvp_backend`.
- `npm run test:integration`: correcto con PostgreSQL desechable en Docker Compose; la comprobación PostgreSQL/API pasó y Compose eliminó el contenedor y la red temporales. El script no lee `DATABASE_URL` del entorno. En Windows localiza Docker Desktop en las rutas de instalación habituales y permite configurar `DOCKER_CLI_PATH` si la instalación está en otra ruta.
- Revisión manual en navegador (14/10/2026): la instancia antigua de Vite que ocupaba `127.0.0.1:5173` mostraba la página en blanco. Tras reiniciar ese proceso, la interfaz cargó correctamente. Se comprobaron el resumen, API y base de datos disponibles, cambio de tema, menú responsive y ruta ADM-01 con estado vacío. No fue necesario cambiar código para resolver el problema.

La aceptación funcional del propietario se recibió el 14/10/2026. TASK-001 seguirá abierta hasta completar la revisión técnica e integrar la rama conforme a AGENTS.md.
