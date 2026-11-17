# TASK-003 — Documentos, mantenimiento y combustible

**Estado:** En curso
**Prioridad:** P1  
**Milestone:** M2 - Control de recursos

## Objetivo

Dar seguimiento documental, preventivo/correctivo y de cargas de combustible a los vehículos y personal.

## Prerrequisitos

- TASK-002 completada.
- TASK-007 integrada en mvp-base, con asociación protegida de archivos a documentos de vehículos y empleados.
- Contrato de archivos y permisos de mvp-base identificado.

## Alcance

- Documentos de vehículo o empleado con referencia de archivo y vigencia.
- Historial de mantenimiento correctivo y planes preventivos por km/fecha.
- Bloqueo operativo durante mantenimiento que impida usar el vehículo.
- Tanques por vehículo y cargas diferenciadas para gasolina/GNV.

## Criterios de aceptación

- Los documentos respetan titular y empresa; las renovaciones conservan historial.
- Un plan de 5.000 km presenta el siguiente objetivo por odómetro; al configurar intervalo temporal presenta también su ventana de fechas.
- La pantalla identifica planes dentro de su ventana por fecha y planes cuyo odómetro objetivo fue alcanzado.
- Una carga identifica su tanque, combustible, unidad, cantidad, costo y kilometraje.
- Gasolina y GNV no se mezclan en las cantidades de los reportes.
- Las cargas y sus resúmenes se filtran por vehículo, combustible y periodo; cada carga muestra el precio unitario calculado a partir del importe y cantidad.
- La lista de documentos permite filtrar por titular, tipo y vigencia, conservando las renovaciones en el historial.
- Vehículos fuera de servicio no se ofrecen para asignación.

## Avance — 2026-11-12

- Se creó y aplicó la migración `20261112111255_task_003_documents_maintenance_fuel` en `mvp_transport_local`. Añade documentos con historial de renovación, planes y registros de mantenimiento, tanques por vehículo y cargas asociadas al tanque.
- La API valida alcance de empresa/sucursal con mvp-base, registra auditoría y consume el contrato HTTP de archivos privados de PR #37 para vehículos y empleados. La carga conserva referencia externa; Transporte no duplica el almacenamiento de Base.
- La web incorpora la sección Recursos para documentos, mantenimiento y combustible. Las listas separan gasolina y GNV por unidad y moneda.
- Las cargas y sus resúmenes aceptan filtros por combustible y fechas; cada fila expone el precio unitario calculado desde el costo total y la cantidad.
- La lista de documentos filtra por titular seleccionado, texto del tipo documental y estado de vigencia.
- El mantenimiento en curso puede marcar el vehículo fuera de servicio; la API y la lista de vehículos exponen ese bloqueo. TASK-004 aplica el bloqueo al validar asignaciones.
- El submódulo mvp-base está inicializado en el commit fijado `97c5840211e593a9fd91775fe30383a173feeb35`. Se aplicaron sus migraciones pendientes a `mvp_backend`; Transporte no tenía migraciones pendientes en `mvp_transport_local`.
- Las APIs locales de Base y Transporte responden y el arranque de Transporte registró `EMPLOYEE` y `VEHICLE` en el manifiesto de archivos de Base. La clave de servicio se comparte solo entre los `.env` de servidor y `http://localhost:5174` está permitido en `WEB_ORIGINS`.
- TASK-003 continúa en curso: falta completar una carga, listado y descarga reales con una sesión autorizada, permisos asignados y un vehículo o empleado de prueba asociado a una empresa local. El bloqueo de asignación de viajes sigue pendiente de TASK-004.
- `npm run build` compila los paquetes y las aplicaciones de ambos repositorios. No se ejecutaron pruebas.

## Avance — 2026-11-16

- La API y la web filtran cargas y resúmenes de combustible por vehículo, tipo y rango de fechas; cada carga muestra el precio unitario calculado.
- La lista de documentos filtra por tipo y vigencia; el titular se elige en el selector de vehículo o empleado.
- `/maintenance/upcoming` y la pantalla de mantenimiento muestran planes dentro de su ventana operativa o con el odómetro objetivo alcanzado.
- Las fechas de mantenimiento y las comprobaciones de vencimiento de documentos durante viajes usan el día calendario de `America/La_Paz`, de forma consistente con la planificación de viajes.
- Los filtros de combustible, el cálculo visual de vigencias y la captura de fechas en web también usan el calendario operativo de `America/La_Paz`, independiente del huso del navegador.
- La API autoriza la carga documental antes de acumular el cuerpo multipart en memoria y responde `413 REQUEST_TOO_LARGE` cuando el parser excede el límite.
- Los registros de combustible y las ediciones del vehículo bloquean la fila del vehículo dentro de la transacción para mantener el odómetro monotónico ante solicitudes concurrentes.
- TASK-003 sigue en curso hasta completar la verificación funcional de archivos con una sesión local. La asociación de comprobantes de combustible requiere una tarea explícita para extender el contrato de mvp-base.
- Se realizó typecheck de API/web y build de `shared-contracts`; no se ejecutaron pruebas ni se compiló el APK por indicación del propietario.
