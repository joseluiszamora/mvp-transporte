# TASK-005 — Consulta móvil del conductor

**Estado:** Bloqueado
**Prioridad:** P2  
**Milestone:** M4 - Operación móvil

## Objetivo

Permitir que el conductor consulte sus viajes y actualice su estado desde Flutter.

## Prerrequisitos

- API de viajes y asignaciones estable.
- Sesión móvil con mvp-base definida, incluyendo un origen de app permitido y almacenamiento seguro del refresh token y CSRF.
- Contrato público de mvp-base para resolver al empleado activo asociado al usuario autenticado dentro de la empresa autorizada.

## Alcance

- Inicio de sesión con el mecanismo compartido.
- Lista y detalle de viajes del conductor autenticado.
- Actualización permitida del estado e inicio/fin.
- Manejo claro de errores y confirmación de guardado.

## Criterios de aceptación

- El conductor solo consulta viajes asignados a él dentro de la empresa activa.
- Las actualizaciones quedan registradas con fecha y actor.
- La app usa la API; no accede directamente a PostgreSQL.

## Bloqueo de integración detectado — 2026-11-12

La sesión actual de mvp-base identifica al usuario y la organización, pero no devuelve el empleado asociado. `GET /employees/{employeeId}` necesita que el cliente ya conozca el ID; el campo `linkedUser` requiere permisos de lectura personal y de usuarios, y el propio mvp-base aclara que vincular la cuenta no concede acceso a la aplicación. El contrato de integración `transport/authorize` devuelve el actor, pero no su relación con Employee.

Transporte no aceptará un `employeeId` enviado por la app como identidad, ni consultará directamente la base de mvp-base. Hace falta que mvp-base exponga una operación pública de autoservicio que, dado el Bearer autenticado y una empresa autorizada, devuelva únicamente el empleado activo asociado a ese usuario (o un error si no existe una única relación). Con ese dato, Transporte podrá filtrar viajes y autorizar transiciones desde sus propias tablas.

La autenticación móvil también debe usar un origen registrado en mvp-base y guardar los tokens rotativos en almacenamiento seguro del dispositivo. Una vez acordado y autorizado ese contrato de identidad, se implementarán el endpoint de conductor en Transporte y la app Flutter.

## Próximos pasos

1. Acordar e implementar en mvp-base la consulta de empleado propio con autorización de empresa.
2. Registrar permisos móviles específicos y endpoints de viajes propios en Transporte, con auditoría compartida.
3. Crear `apps/mobile` en Flutter para sesión, lista, detalle y transiciones permitidas.
4. Actualizar los documentos de integración y la guía de ejecución móvil.
