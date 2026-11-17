# TASK-001 — Integrar mvp-base con mvp-transporte

**Estado:** En revisión · **Prioridad:** P0 · **Milestone:** M0 - Base del producto

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
- Se confirmó la selección de los diez módulos ADM de mvp-base; la automatización de avisos de ADM-09 permanece diferida según ADR-007.
- La decisión y el procedimiento para inicializar o actualizar el submódulo están registrados en `docs/decisions.md`.

## Avance — 2026-11-05

- Se revisaron los exports, scripts, rutas HTTP, contratos TypeScript, permisos, archivos, auditoría, esquema Prisma y migraciones de la revisión fijada de mvp-base.
- ADR-011 establece APIs HTTP entre aplicaciones independientes y bases separadas. Transporte conserva referencias externas y su propio historial Prisma; no importa código ni consulta las tablas de mvp-base.
- Se agregó README y scripts de raíz; ahora incluyen los workspaces propios de Transporte y conservan los comandos de mvp-base.
- Se documentaron las interfaces existentes y sus límites en `docs/integration/mvp-base.md` y `docs/modules/ADM-XX-mvp-base-reference.md`.
- La revisión encontró un requisito de integración faltante: autorización de códigos `transport.*` con alcance, asociación de archivos a vehículos e ingreso de auditoría. TASK-007 especifica la extensión que debe integrarse desde mvp-base.

## Pendiente de integrar en Transporte

- Integrar el Pull Request de TASK-001 en `main` de Transporte.
- Ejecutar instalación limpia y validaciones de ambos proyectos. La inicialización local del submódulo falló por `NtCreateDirectoryObject ... 0xC0000022`, así que no se ejecutó la validación combinada.

## Actualización — 2026-11-11

- El propietario aceptó el contrato y el [PR #37](https://github.com/joseluiszamora/mvp-base/pull/37) se fusionó en `main` de mvp-base como `97c5840211e593a9fd91775fe30383a173feeb35`.
- La revisión técnica corrigió el filtrado de archivos externos por empresa/sucursal; `9331064` añadió una regresión. CI runs 59 y 60 pasaron.
- Esta rama actualiza el submódulo de Transporte a `97c5840` y sincroniza la documentación. La API y web de Transporte ya se iniciaron en sus workspaces propios; su primera entrega vertical se documenta en TASK-002.
