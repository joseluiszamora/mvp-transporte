# TRN-03 — Viajes y asignaciones

## Propósito

Planificar viajes y asignar vehículo y tripulación con reglas específicas por tipo.

## Tipos de viaje

### Distribución

- Jornada normalmente completa.
- Se vinculará con la planificación diaria de entregas cuando ese módulo esté definido.
- Requiere uno o dos ayudantes totales.
- Los ayudantes pueden ser internos, proporcionados por el cliente o una combinación; cuando el cliente aporta el ayudante puede no haber ayudantes internos.

### Ruta corta

- Tarea simple de pocas horas.
- Una o dos paradas.
- Sin ayudante en el flujo inicial.
- No requiere una ruta reutilizable.

### Viaje largo

- Servicio interdepartamental contratado por una empresa.
- Puede durar varios días.
- Registra empresa contratante y dato(s) del precinto.
- Puede registrar relevos de conductor con intervalos sucesivos.
- Los ayudantes son opcionales según el servicio.

## Reglas de asignación

- Un viaje usa un vehículo en la primera versión y requiere un conductor para cada intervalo operativo.
- TripCrewAssignment registra empleado interno o ayudante del cliente, rol, origen y periodo.
- Para ayudante externo, nombre opcional y origen CLIENTE; no requiere Employee.
- Una distribución debe tener entre uno y dos ayudantes totales.
- No se permiten superposiciones de vehículo ni de persona interna en viajes distintos.
- Verificar estado del vehículo, mantenimiento y documentos vigentes antes de confirmar.
- Estados de viaje: planificado, asignado, en curso, completado y cancelado.
- Guardar fechas previstas y reales; conservar los cambios de conductor.
- Registrar quién creó, asignó, inició y completó el viaje usando la identidad de mvp-base.
- Confirmar e iniciar revalidan disponibilidad del vehículo, mantenimiento, documentos vigentes registrados y perfiles/estado de empleados.
- Los cambios de asignación y de estado se guardan como eventos locales y se envían a auditoría de mvp-base.
- La cancelación exige motivo, libera los intervalos activos y conserva su historial.

El arqueo de ayudantes queda fuera del alcance.

## Criterios de aceptación

- Crear los tres tipos con campos relevantes.
- Validar cantidad y origen de ayudantes en distribución.
- Bloquear asignaciones solapadas o recursos no disponibles.
- Permitir relevos de conductor en un viaje largo sin perder historial.
- Registrar inicio, finalización y cancelación con sus fechas.

## Implementación TASK-004

La API expone `/trips`, `/trips/{tripId}`, `/trips/{tripId}/assignment` y `/trips/{tripId}/status`. Una planificación nace en `PLANNED`; al pasar a `ASSIGNED`, el servicio valida la cobertura completa de conductores y toma bloqueos transaccionales por vehículo y empleado antes de consultar solapamientos. Los intervalos contiguos pueden compartir límite de fin/inicio.

El flujo revisa documentos operativos `CURRENT` con vencimiento anterior al día de fin del viaje. Como no hay un catálogo que marque documentos obligatorios por tipo, la ausencia de un documento no bloquea la asignación; se rechaza un documento vencido que sí esté registrado como actual.
