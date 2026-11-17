# TRN-05 — Mantenimiento

**Estado:** En curso — planes, registros, consulta de vencimientos y marca fuera de servicio implementados; las notificaciones automáticas no están incluidas.

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
- Mostrar mantenimiento próximo según kilometraje alcanzado y rango de fechas configurado.

## Avance de implementación

- Los planes calculan el siguiente km/fecha y la ventana configurable; completar un servicio avanza el siguiente vencimiento.
- El vehículo expone `maintenanceBlocked` mientras un registro en curso marque `outOfService`.
- La consulta `/maintenance/upcoming` devuelve los planes activos dentro de su ventana de fechas o cuyo odómetro objetivo ya se alcanzó, ordenando primero los vencidos. Las notificaciones automáticas de vencimiento se mantienen diferidas.
- La API de asignaciones consume la señal de mantenimiento durante la planificación del viaje (TASK-004).
