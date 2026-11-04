# TASK-001 — Integrar mvp-base con mvp-transporte

**Estado:** Pendiente  
**Prioridad:** P0  
**Milestone:** M0 - Base del producto

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

## Criterios de aceptación

- La decisión de integración y la versión/commit de mvp-base quedan documentados.
- Se puede inicializar el proyecto siguiendo los pasos del README.
- La estructura no contiene copias duplicadas de módulos base.
- Se identifican comandos reales de instalación, ejecución y validación.
- La API y web de mvp-transporte tienen límites documentados.
