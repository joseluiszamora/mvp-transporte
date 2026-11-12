# TASK-001 — Integrar mvp-base con mvp-transporte

**Estado:** En curso · **Prioridad:** P0 · **Milestone:** M0 - Base del producto

## Objetivo

Inspeccionar ambos repositorios y establecer una integración reproducible que preserve mvp-base como fuente de verdad.

## Prerrequisitos

- Acceso de lectura a mvp-base.
- Repositorio mvp-transporte creado y disponible localmente.
- Revisar AGENTS.md e instrucciones aplicables en ambos repositorios.

## Alcance

- Inspeccionar paquetes, exports, dependencias, scripts, autenticación, empresa activa, personal, permisos, archivos, auditoría y Prisma.
- Elegir paquetes versionados si existen; de lo contrario, usar submódulo fijado a commit/tag.
- Documentar cómo actualizar la referencia a mvp-base.
- Preparar estructura para API/web y documentos del producto.
- Definir procedimiento coherente para esquema y migraciones.

## Fuera de alcance

- Copiar código o tablas de mvp-base.
- Reorganizar el sistema base.
- Publicar paquetes, cambiar permisos o desplegar.
- Implementar reglas de negocio de transporte.
- Modificar mvp-base desde este repositorio sin una tarea explícita en su repositorio.

## Criterios de aceptación

- La decisión de integración y la versión/commit de mvp-base quedan documentados.
- Se puede inicializar el proyecto siguiendo los pasos del README.
- La estructura no contiene copias duplicadas de módulos base.
- Se identifican comandos reales de instalación, ejecución y validación.
- La API y web de mvp-transporte tienen límites documentados.

## Avance — 2026-11-04

- Se agregó mvp-base como submódulo en `mvp-base/`, fijado a `52f2e449dcf3a8109481fed55117327f1bd59b38`.
- Se confirmó que mvp-base es un monorepo npm privado y que `@mvp-base/contracts` es un paquete privado de su workspace, no una distribución versionada independiente.
- Se confirmó la selección de los diez módulos ADM de mvp-base; la automatización de avisos de ADM-09 permanece diferida según ADR-007. Los contratos concretos siguen pendientes de verificación.
- La decisión y el procedimiento para inicializar o actualizar el submódulo están registrados en `docs/decisions.md`.

## Avance — 2026-11-05

- Se revisaron los exports, scripts, rutas HTTP, contratos TypeScript, permisos, archivos, auditoría, esquema Prisma y migraciones de la revisión fijada de mvp-base.
- ADR-011 establece APIs HTTP entre aplicaciones independientes y bases separadas. Transporte conserva referencias externas y su propio historial Prisma; no importa código ni consulta las tablas de mvp-base.
- Se agregó README y scripts de raíz. En esta fase delegan en los scripts existentes de mvp-base para preparar, arrancar y validar lo actualmente ejecutable.
- Se documentaron las interfaces existentes y sus límites en `docs/integration/mvp-base.md` y `docs/modules/ADM-XX-mvp-base-reference.md`.
- La revisión encontró un requisito de integración faltante: autorización de códigos `transport.*` con alcance, asociación de archivos a vehículos e ingreso de auditoría. TASK-007 especifica la extensión que debe integrarse desde mvp-base.

## Pendiente

- Completar la integración de TASK-015 en mvp-base. La revisión técnica corrigió el filtrado por empresa/sucursal y añadió una regresión; CI run 59 pasó en `9331064`. El PR #37 está listo para revisión independiente y fusión a `main`.
- Después de integrar el contrato en `main` de mvp-base, fijar el commit resultante en el submódulo de Transporte.
- Crear la API/web de Transporte y extender los scripts de raíz para que cubran su código, sin dejar de ejecutar los checks de mvp-base.
- Ejecutar instalación limpia y validaciones de los dos proyectos una vez disponible la implementación; no se han ejecutado en esta revisión.

## Actualización — 2026-11-11

- GitHub confirma que `main` de mvp-base continúa en `52f2e449dcf3a8109481fed55117327f1bd59b38` y que `8435ec91e8c8e2370684904afd4bc8df0bda737d` existe solo en `task/007-transport-integration-contract`.
- La rama candidata implementa la tarea equivalente TASK-015 y publica la guía de integración de APIs de producto. La revisión técnica detectó y corrigió el filtrado incompleto de archivos externos por empresa/sucursal; `9331064` añade una prueba de regresión y CI run 59 pasó. El [PR #37](https://github.com/joseluiszamora/mvp-base/pull/37) está listo para revisión independiente.
- Se actualizaron las referencias de Transporte para distinguir la interfaz actual de `main` del contrato candidato. La dependencia sigue abierta y Transporte no debe habilitar escrituras todavía.
