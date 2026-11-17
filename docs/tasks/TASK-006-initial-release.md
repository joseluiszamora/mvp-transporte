# TASK-006 — Integración y versión inicial

**Estado:** En curso
**Prioridad:** P1  
**Milestone:** M5 - Versión inicial

## Objetivo

Cerrar el alcance inicial y preparar una versión revisable de mvp-transporte.

## Prerrequisitos

- Tareas TASK-001 a TASK-005 integradas o con alcance móvil expresamente pospuesto.

## Alcance

- Revisión de permisos y aislamiento empresarial.
- Revisión de archivos, auditoría, migraciones e historial.
- Validación de los escenarios de vehículos, documentos, mantenimiento, combustible y tipos de viaje.
- Actualización de README, product, architecture, data-model y roadmap.
- Preparación de tag de versión cuando el repositorio cumpla los criterios.

## Criterios de aceptación

- No hay acceso cruzado entre empresas.
- Los criterios del MVP se pueden verificar en los flujos web/móvil comprometidos.
- Comandos de validación reales quedan documentados.
- La documentación refleja el estado del repositorio y las limitaciones conocidas.
- El tag v1.0.0 solo se crea cuando el alcance de lanzamiento está completo.

## Avance — 2026-11-16

- La revisión estática encontró que CORS no permitía `PUT`, aunque la web usa ese método para reemplazar la asignación de un viaje. Se habilitó `PUT` en la lista de métodos de la API.
- La especificación OpenAPI ahora describe `/openapi.json` como una ruta pública, en línea con su implementación.
- Se actualizaron las referencias al pin actual del submódulo `mvp-base` a `1a2d0d4`; `97c5840` se conserva como la revisión histórica del contrato TASK-015.
- La web y la app móvil ahora interpretan y presentan fechas operativas en `America/La_Paz`, aunque el navegador o dispositivo tenga otra zona horaria.
- Las APIs de viajes y combustible rechazan fechas sin zona horaria y calendarios imposibles; los clientes deben enviar instantes RFC 3339 explícitos.
- Las comprobaciones funcionales de aislamiento, archivos y recorridos web/móvil siguen pendientes; no se ejecutaron pruebas ni se preparó el tag de versión.
