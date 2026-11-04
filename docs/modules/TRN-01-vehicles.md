# TRN-01 — Vehículos

## Propósito

Registrar vehículos disponibles para las operaciones de transporte y conservar su historial.

## Alcance

- Alta, consulta, edición y desactivación.
- Búsqueda por placa, tipo y estado.
- Datos básicos de identificación, capacidad y kilometraje.
- Disponibilidad operativa relacionada con asignaciones y mantenimiento.
- Relación con documentos, tanques, combustible y mantenimientos.

Propietarios y agrupaciones de flota se difieren.

## Reglas de negocio

- Cada vehículo pertenece a una empresa.
- La placa es única dentro de la empresa.
- Estados iniciales sugeridos: disponible, asignado, mantenimiento e inactivo; adaptar a catálogos y convenciones existentes.
- Un vehículo inactivo, bloqueado por mantenimiento o ya asignado en el intervalo no puede recibir una asignación nueva.
- Mantener registros históricos; desactivar en lugar de borrar si hay relaciones operativas.
- Kilometraje registrado no debe disminuir salvo corrección auditada.

## Datos principales

Vehicle: plate, vehicleType, make, model, year, capacity, odometer, status, companyId, createdAt, updatedAt. Confirmar unidades de capacidad con el uso real antes de implementar.

## Dependencias

- mvp-base: empresa, permisos, auditoría y archivos.
- TRN-05: disponibilidad por mantenimiento.
- TRN-06: tanques y cargas de combustible.
- TRN-03: viajes y asignaciones.

## Criterios de aceptación

- Un usuario autorizado registra y edita un vehículo en su empresa.
- Una placa duplicada en la misma empresa se rechaza.
- Un usuario de otra empresa no puede leerlo ni modificarlo.
- El historial asociado se conserva al desactivar el vehículo.
