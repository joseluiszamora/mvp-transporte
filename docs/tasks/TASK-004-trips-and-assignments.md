# TASK-004 — Viajes y asignaciones

**Estado:** Pendiente  
**Prioridad:** P0  
**Milestone:** M3 - Operación de viajes

## Objetivo

Planificar distribución, rutas cortas y viajes largos, asignando vehículo y tripulación.

## Prerrequisitos

- TASK-002 completada.
- TASK-003 completada o disponibilidad/documentos implementados.
- Modelo de distribución diaria identificado para el vínculo futuro.

## Alcance

- Tipos de viaje, estados y fechas previstas/reales.
- Vehículo y tripulación con periodos de participación.
- Ayudantes internos y del cliente, con origen y nombre externo opcional.
- Relevos de conductor en viajes largos.
- Una o dos paradas simples en ruta corta.
- Empresa contratante y precinto en viaje largo.
- Validación de solapamientos y disponibilidad.

## Criterios de aceptación

- Distribución registra uno o dos ayudantes totales; personal del cliente cuenta aunque no se asigne empleado propio.
- Ruta corta admite una o dos paradas y no requiere ayudante.
- Viaje largo puede cubrir varios días y conservar relevos de conductor.
- Vehículo y personal interno no pueden asignarse a periodos superpuestos.
- Se conserva historial de cambios, inicio, finalización y cancelación.
- El arqueo de ayudantes no se implementa.
