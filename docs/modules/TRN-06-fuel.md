# TRN-06 — Combustible

**Estado:** En curso — configuración de tanques, cargas y resumen por combustible implementados.

## Propósito

Registrar tanques y cargas de combustible por vehículo, manteniendo separadas gasolina y GNV.

## Configuración de tanques

VehicleFuelTank pertenece a un vehículo y define tipo de combustible, capacidad, unidad y estado. Un vehículo puede tener un tanque de gasolina y uno de GNV, más de un tanque si la configuración lo requiere.

## Registro de cargas

FuelRecord guarda tanque, fecha, cantidad, unidad, precio por unidad, importe total, kilometraje, estación/proveedor, comprobante y viaje relacionado si se conoce.

## Reglas de negocio

- No registrar una carga para un tanque que no pertenece al vehículo indicado.
- No mezclar volúmenes de combustibles distintos en reportes.
- Mostrar litros o unidad configurada por tipo de combustible.
- Los costos monetarios pueden resumirse en moneda configurada.
- Kilometraje no decreciente, salvo corrección auditada.
- El control inicial registra cargas; cuotas, tarjetas, detección de fraude y analítica avanzada se difieren.

## Criterios de aceptación

- Configurar al menos un tanque por vehículo.
- Registrar gasolina y GNV en tanques distintos para el mismo vehículo.
- Consultar cantidades y costos filtrados por vehículo, combustible y fecha.
- Vincular el comprobante usando el servicio de archivos compartido.

## Avance de implementación

- El tanque determina combustible y unidad; la carga solo acepta un tanque activo del mismo vehículo y no supera su capacidad.
- Los resúmenes separan combustible, unidad y moneda. Gasolina usa litros; GNV admite metros cúbicos o kilogramos.
- El costo total, odómetro y proveedor se guardan. Recibo, precio unitario y filtros por periodo quedan pendientes para una siguiente iteración.
