# Roadmap

## Estado

Todos los entregables comienzan en estado **Pendiente**. Actualizar este archivo cuando una tarea se integre en main.

Estados permitidos: Pendiente, En curso, Bloqueado, En revisión y Completado.

## Orden de fases

| Fase | Entrega | Dependencias | Milestone GitHub | Estado |
|---|---|---|---|---|
| 0 | Repositorio mvp-transporte e integración con mvp-base | Acceso a ambos repositorios y revisión de su estructura; TASK-007 | M0 - Base del producto | En curso |
| 1 | Vehículos y perfiles operativos | Fase 0, modelo de empresa y personal | M1 - Recursos principales | Pendiente |
| 2 | Documentos, mantenimiento y combustible | Vehículos y personal | M2 - Control de recursos | Pendiente |
| 3 | Viajes y asignaciones | Recursos, disponibilidad y documentos | M3 - Operación de viajes | Pendiente |
| 4 | App móvil para conductor | API de viajes estable | M4 - Operación móvil | Pendiente |
| 5 | Integración y versión inicial | Fases 1–4 y revisión de permisos | M5 - Versión inicial | Pendiente |

## Fase 0 — Base

- Inspeccionar mvp-base: paquetes, contratos, autenticación, empresa activa, personal, archivos, permisos, auditoría, Prisma y comandos.
- Fijar integración con paquete versionado si existe; de lo contrario, evaluar submódulo con commit/tag exacto.
- Crear API/web en monorepo, configuración local, documentación y controles de GitHub.
- Salida: aplicación local arranca y no duplica módulos base.
- Dependencia identificada: TASK-007 debe exponer autorización contextual, archivos para recursos de transporte y escritura de auditoría. La aplicación de transporte no debe habilitar escrituras antes de esa integración.

## Fase 1 — Recursos principales

- CRUD de vehículos y disponibilidad.
- Perfiles de conductor y ayudante vinculados a Employee.
- Una persona puede ser conductor, ayudante o ambos.
- Salida: recursos aislados por empresa y con historial.

## Fase 2 — Control de recursos

- Documentos con archivos y vencimiento.
- Mantenimiento correctivo y planes preventivos por km/fecha.
- Tanques y cargas de gasolina/GNV por separado.
- Salida: vehículos no disponibles por mantenimiento quedan fuera de asignaciones nuevas.

## Fase 3 — Viajes y asignaciones

- Distribución, ruta corta y viaje largo.
- Tripulación interna y de cliente, con relevos de conductor.
- Fechas y estados de viaje, paradas simples para ruta corta, datos de contratante/precinto para viaje largo.
- Salida: validación de disponibilidad, documentación y reglas de ayudantes.

## Fase 4 — App del conductor

- Consulta de viajes propios.
- Actualización de estado e inicio/fin de viaje.
- Salida: app restringida a viajes de la empresa y conductor autenticados.

## Fase 5 — Versión inicial

- Revisión de aislamiento, permisos, archivos, historial y documentación.
- Corregir hallazgos y preparar tag v1.0.0.
- Salida: criterios del MVP cubiertos y guía de operación actualizada.

## Dependencias y cambios

Si una fase requiere una función de mvp-base, crear una tarea específica de integración y mantener el cambio común en mvp-base. No bloquear toda la fase por una integración no identificada: documentar el bloqueo y avanzar las tareas independientes.
