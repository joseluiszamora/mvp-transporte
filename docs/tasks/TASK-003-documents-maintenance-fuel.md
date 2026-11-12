# TASK-003 — Documentos, mantenimiento y combustible

**Estado:** Pendiente  
**Prioridad:** P1  
**Milestone:** M2 - Control de recursos

## Objetivo

Dar seguimiento documental, preventivo/correctivo y de cargas de combustible a los vehículos y personal.

## Prerrequisitos

- TASK-002 completada.
- TASK-007 integrada en mvp-base, con asociación protegida de archivos a vehículos y comprobantes.
- Contrato de archivos y permisos de mvp-base identificado.

## Alcance

- Documentos de vehículo o empleado con referencia de archivo y vigencia.
- Historial de mantenimiento correctivo y planes preventivos por km/fecha.
- Bloqueo operativo durante mantenimiento que impida usar el vehículo.
- Tanques por vehículo y cargas diferenciadas para gasolina/GNV.

## Criterios de aceptación

- Los documentos respetan titular y empresa; las renovaciones conservan historial.
- Un plan de 5.000 km presenta siguiente objetivo y ventana de fechas.
- Una carga identifica su tanque, combustible, unidad, cantidad, costo y kilometraje.
- Gasolina y GNV no se mezclan en las cantidades de los reportes.
- Vehículos fuera de servicio no se ofrecen para asignación.
