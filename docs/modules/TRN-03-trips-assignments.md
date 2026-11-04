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

El arqueo de ayudantes queda fuera del alcance.

## Criterios de aceptación

- Crear los tres tipos con campos relevantes.
- Validar cantidad y origen de ayudantes en distribución.
- Bloquear asignaciones solapadas o recursos no disponibles.
- Permitir relevos de conductor en un viaje largo sin perder historial.
- Registrar inicio, finalización y cancelación con sus fechas.
