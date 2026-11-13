# TRN-05 — Mantenimiento

**Estado:** En curso — planes, registros y marca fuera de servicio implementados; la asignación de viajes pertenece a TASK-004.

## Propósito

Registrar reparaciones correctivas y programar mantenimiento preventivo de vehículos.

## Mantenimiento correctivo

Casos iniciales: pinchazo, raspón y reparación menor. Registrar categoría, descripción, fecha, kilometraje, costo, proveedor y archivos disponibles.

## Mantenimiento preventivo

- Permitir planes por vehículo o tipo de tarea.
- Incluir intervalo por kilometraje, por tiempo o ambos.
- Ejemplo aprobado: cambio de aceite cada 5.000 km.
- Registrar kilometraje de último servicio, siguiente kilometraje objetivo y rango previsto de fechas, por ejemplo del 21 al 27 de septiembre.
- Al completar un servicio, crear el registro histórico y avanzar el próximo vencimiento.
- Mostrar tareas próximas y vencidas.
- Permitir marcar el vehículo fuera de servicio durante el periodo de mantenimiento que impida operar.

## Criterios de aceptación

- Crear plan periódico y calcular el siguiente kilometraje objetivo.
- Registrar servicio realizado con fecha y odómetro.
- Conservar servicios anteriores.
- Bloquear nuevas asignaciones cuando el vehículo esté fuera de servicio.
- Mostrar mantenimiento próximo según kilometraje y rango de fechas.

## Avance de implementación

- Los planes calculan el siguiente km/fecha y la ventana configurable; completar un servicio avanza el siguiente vencimiento.
- El vehículo expone `maintenanceBlocked` mientras un registro en curso marque `outOfService`.
- El API de asignaciones consumirá esta señal cuando se implemente TASK-004. Las notificaciones de vencimiento y la consulta dedicada de tareas próximas siguen pendientes.
