# TASK-002 — Vehículos y perfiles operativos

**Estado:** Pendiente  
**Prioridad:** P0  
**Milestone:** M1 - Recursos principales

## Objetivo

Implementar el registro de vehículos y perfiles de conductor/ayudante ligados al personal compartido.

## Prerrequisitos

- TASK-001 completada.
- Contratos de Company, Employee, permisos y auditoría identificados.

## Alcance

- Modelo y migración de vehículo.
- Perfiles de conductor y ayudante relacionados con Employee.
- Alta, consulta, edición, búsqueda y desactivación en API y web.
- Restricciones por empresa y permisos.
- Historial sin borrado físico de recursos referenciados.

## Criterios de aceptación

- Una placa duplicada dentro de la misma empresa se rechaza.
- Una persona puede tener ambos perfiles operativos.
- Un perfil inactivo no puede asignarse.
- Usuarios de otra empresa no pueden acceder al registro.
- Se documentan campos, validaciones y comandos de validación ejecutados.
