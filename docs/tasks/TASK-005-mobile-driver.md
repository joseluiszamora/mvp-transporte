# TASK-005 — Consulta móvil del conductor

**Estado:** Pendiente  
**Prioridad:** P2  
**Milestone:** M4 - Operación móvil

## Objetivo

Permitir que el conductor consulte sus viajes y actualice su estado desde Flutter.

## Prerrequisitos

- API de viajes y asignaciones estable.
- Integración de autenticación y empresa activa de mvp-base definida.

## Alcance

- Inicio de sesión con el mecanismo compartido.
- Lista y detalle de viajes del conductor autenticado.
- Actualización permitida del estado e inicio/fin.
- Manejo claro de errores y confirmación de guardado.

## Criterios de aceptación

- El conductor solo consulta viajes asignados a él dentro de la empresa activa.
- Las actualizaciones quedan registradas con fecha y actor.
- La app usa la API; no accede directamente a PostgreSQL.
