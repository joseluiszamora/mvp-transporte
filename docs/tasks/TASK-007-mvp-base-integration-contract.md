# TASK-007 — Contrato público de integración para mvp-transporte

**Estado:** En revisión · **Prioridad:** P0 · **Repositorio de implementación:** mvp-base

La implementación candidata está en `mvp-base` TASK-015, rama `task/007-transport-integration-contract`. El [PR #37](https://github.com/joseluiszamora/mvp-base/pull/37) está listo para revisión independiente. La revisión técnica corrigió el aislamiento del listado de archivos por empresa/sucursal y agregó una regresión; CI run 59 pasó en `9331064`. La interfaz de `main` continúa en `52f2e449`; ver [estado de integración](../integration/mvp-base.md).

## Objetivo

Extender las interfaces públicas de mvp-base para que una API de producto pueda autorizar recursos propios, asociar archivos privados y registrar auditoría sin importar módulos internos ni consultar tablas de la plataforma.

## Prerrequisitos

- Revisión de mvp-base fijada en ADR-002.
- ADR-011 y `docs/integration/mvp-base.md` de mvp-transporte.
- Acordar en mvp-base el contrato de autenticación entre APIs y mantener su modelo de permisos como fuente de verdad.

## Alcance

- Proveer validación de sesión/membresía y autorización contextual por organización, empresa y sucursal para códigos de permiso registrados por productos integrados.
- Permitir registrar códigos `transport.*` en el módulo común de permisos para que puedan asignarse a roles desde mvp-base.
- Proveer asociación, lectura y descarga de archivos privados para recursos externos de Transporte, incluidos vehículos y comprobantes, con validación de alcance.
- Proveer ingreso autenticado de eventos de auditoría de productos integrados; el actor y la organización deben derivarse de contexto validado, no de campos del cliente.
- Publicar contratos HTTP y TypeScript estables, documentación OpenAPI, migraciones compatibles y pruebas de integración.

## Fuera de alcance

- Implementar reglas de negocio de vehículos, viajes, mantenimiento o combustible en mvp-base.
- Permitir acceso directo de mvp-transporte a tablas o almacenamiento privado de mvp-base.
- Aceptar identidad, empresa, alcance o actor como autorizados por valores enviados por el navegador.
- Cambiar permisos, despliegues o datos reales sin el flujo de aprobación de mvp-base.

## Pasos sugeridos

1. Diseñar el límite de confianza entre el API de producto y mvp-base, incluyendo expiración/revocación de sesión y autenticación del servicio consumidor.
2. Definir el contrato para verificar permisos a un recurso externo dentro del alcance de empresa/sucursal y registrar los códigos permitidos.
3. Definir cómo la plataforma confirma titularidad del archivo y protege la descarga de recursos externos.
4. Definir el ingreso de eventos de auditoría con actor validado y campos permitidos.
5. Implementar, documentar OpenAPI/contratos, migrar y cubrir el comportamiento con pruebas de integración.
6. Integrar el commit/tag de mvp-base en mvp-transporte y actualizar la ficha ADM y la guía de integración.

## Criterios de aceptación

- Una sesión revocada, membresía suspendida o permiso ausente no autoriza una operación de Transporte.
- La autorización respeta la organización, empresa y sucursal del recurso; no se puede forzar cambiando IDs del cliente.
- Los códigos de Transporte se administran mediante los roles comunes de mvp-base.
- Un archivo de vehículo se carga, consulta y descarga solo por actores autorizados y permanece almacenado por el servicio de archivos común.
- Un evento de Transporte aparece en la auditoría con actor y organización validados por mvp-base.
- La API de Transporte usa solo interfaces públicas documentadas.
- Las migraciones y pruebas se ejecutan en una base de prueba y no duplican modelos de plataforma.

## Documentos que deben actualizarse

- mvp-base: decisiones, arquitectura, seguridad, documentación de APIs, OpenAPI, catálogo de permisos, modelo de datos y guía operativa.
- mvp-transporte: `docs/integration/mvp-base.md`, `docs/modules/ADM-XX-mvp-base-reference.md`, `docs/tasks/TASK-001-integrate-mvp-base.md` y `docs/roadmap.md`.
