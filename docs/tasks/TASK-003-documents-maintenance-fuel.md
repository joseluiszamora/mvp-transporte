# TASK-003 — Documentos, mantenimiento y combustible

**Estado:** En curso
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
- Un plan de 5.000 km presenta el siguiente objetivo por odómetro; al configurar intervalo temporal presenta también su ventana de fechas.
- Una carga identifica su tanque, combustible, unidad, cantidad, costo y kilometraje.
- Gasolina y GNV no se mezclan en las cantidades de los reportes.
- Vehículos fuera de servicio no se ofrecen para asignación.

## Avance — 2026-11-12

- Se creó y aplicó la migración `20261112111255_task_003_documents_maintenance_fuel` en `mvp_transport_local`. Añade documentos con historial de renovación, planes y registros de mantenimiento, tanques por vehículo y cargas asociadas al tanque.
- La API valida alcance de empresa/sucursal con mvp-base, registra auditoría y consume el contrato HTTP de archivos privados de PR #37 para vehículos y empleados. La carga conserva referencia externa; Transporte no duplica el almacenamiento de Base.
- La web incorpora la sección Recursos para documentos, mantenimiento y combustible. Las listas separan gasolina y GNV por unidad y moneda.
- El mantenimiento en curso puede marcar el vehículo fuera de servicio; la API y la lista de vehículos exponen ese bloqueo. La comprobación de asignación se conectará al flujo de viajes de TASK-004, que aún no está implementado.
- El submódulo mvp-base está inicializado en el commit fijado `97c5840211e593a9fd91775fe30383a173feeb35`. Se aplicaron sus migraciones pendientes a `mvp_backend`; Transporte no tenía migraciones pendientes en `mvp_transport_local`.
- Las APIs locales de Base y Transporte responden y el arranque de Transporte registró `EMPLOYEE` y `VEHICLE` en el manifiesto de archivos de Base. La clave de servicio se comparte solo entre los `.env` de servidor y `http://localhost:5174` está permitido en `WEB_ORIGINS`.
- TASK-003 continúa en curso: falta completar una carga, listado y descarga reales con una sesión autorizada, permisos asignados y un vehículo o empleado de prueba asociado a una empresa local. El bloqueo de asignación de viajes sigue pendiente de TASK-004.
- `npm run build` compila los paquetes y las aplicaciones de ambos repositorios. No se ejecutaron pruebas.
