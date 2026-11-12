# TASK-004 — Viajes y asignaciones

**Estado:** En curso
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

## Avance — 2026-11-12

- Se implementaron los modelos `Trip`, `TripStop`, `TripCrewAssignment` y `TripEvent`; la migración `20261112141502_task_004_trips` se aplicó a `mvp_transport_local`.
- La migración incremental `20261112170000_task_004_cancellation_reason_check` refuerza la restricción para exigir un motivo de cancelación no vacío. Su aplicación queda pendiente: PostgreSQL no responde en `localhost:5433` y el acceso al motor Docker local no estuvo disponible.
- La API permite planificar, revisar historial, reemplazar asignaciones antes del inicio y cambiar estados. La web incorpora el formulario y la operación de viajes.
- Al confirmar o iniciar, se valida el vehículo activo, el mantenimiento programado o fuera de servicio, documentos `CURRENT` vencidos antes del fin, cobertura de conductor, perfiles internos activos y solapamientos de vehículo o persona.
- La distribución exige uno o dos ayudantes totales; la ruta corta exige una o dos paradas y rechaza ayudantes; el viaje largo requiere empresa contratante, precinto(s) y permite relevos sucesivos.
- TASK-003 conserva pendiente la verificación de carga/listado/descarga de archivos solicitada para más adelante. No se ejecutaron pruebas automatizadas.
