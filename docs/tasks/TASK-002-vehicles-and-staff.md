# TASK-002 — Vehículos y perfiles operativos

**Estado:** En curso
**Prioridad:** P0  
**Milestone:** M1 - Recursos principales

## Objetivo

Implementar el registro de vehículos y perfiles de conductor/ayudante ligados al personal compartido.

## Prerrequisitos

- TASK-001 completada.
- TASK-007 integrada en mvp-base, con autorización contextual, auditoría y permisos de transporte disponibles mediante contrato público.
- Contratos de Company, Employee, permisos y auditoría identificados.
- La integración TASK-007 está fijada en mvp-base `97c5840` y el usuario confirmó que la capacidad vehicular se expresa en kilogramos.

## Alcance

- Modelo y migración de vehículo.
- Perfiles de conductor y ayudante relacionados con Employee.
- Alta, consulta, edición, búsqueda y desactivación en API y web.
- Restricciones por empresa y permisos.
- Historial sin borrado físico de recursos referenciados.

## Criterios de aceptación

- Una placa duplicada dentro de la misma empresa se rechaza.
- La capacidad es positiva en kilogramos y el odómetro no es negativo.
- El kilometraje ya registrado no se reduce ni se borra mediante edición normal.
- Una persona puede tener ambos perfiles operativos.
- Los perfiles solo se crean para empleados ACTIVE de la misma empresa, confirmados por la API de mvp-base.
- Un perfil inactivo no puede asignarse cuando se implemente la asignación en TASK-004.
- Usuarios de otra empresa no pueden acceder al registro.
- Se documentan campos, validaciones y comandos de validación ejecutados.

## Implementación en curso

- Se agregaron modelos Prisma y migración incremental en la base independiente de Transporte. Los IDs de organización, empresa, sucursal y empleado no tienen claves foráneas hacia mvp-base.
- La API expone búsqueda, alta, edición y desactivación de vehículos; además, consulta y administra perfiles de conductores y ayudantes.
- La web inicia sesión con mvp-base, selecciona organización/empresa y muestra las pantallas de vehículos y personal operativo.
- La placa se normaliza para rechazar duplicados dentro de una empresa; la capacidad es decimal positiva en kg; el kilometraje es entero, no negativo y no puede disminuir ni borrarse después de registrarse.
- Las escrituras validan permisos por alcance y se auditan mediante el contrato HTTP de mvp-base. El actor necesita el permiso de operación y `transport.audit.write`; la selección de personal además requiere `employees.read`.
- El criterio de asignación de perfiles inactivos se verificará al implementar asignaciones en TASK-004; TASK-002 conserva el estado del perfil para que esa validación no dependa del cliente.

## Avance — 2026-11-12

- Se completó `npm install --no-audit --no-fund` y se sincronizó `package-lock.json`. Se actualizó `@vitejs/plugin-react` a `6.3.0` para resolver su compatibilidad de pares con Vite 8.
- Pasan el build de `packages/shared-contracts`, el `typecheck` y build de API, y el `typecheck` y build de web.
- Biome revisó los 31 archivos de producto sin errores ni avisos. `npm run lint` alcanza esa fase y luego falla porque el checkout local no contiene `mvp-base/package.json`; el submódulo no está inicializado.
- El build de web finaliza y Vite avisa que el bundle JavaScript principal supera 500 kB minificados. Se deja como mejora de carga dividir el bundle cuando aumente el alcance de la web.
- No se ejecutaron pruebas. La integración combinada con mvp-base queda pendiente de un checkout inicializado; no se modificó ese repositorio.
- La restricción de asignación de perfiles inactivos sigue diferida a TASK-004, donde existirá la operación que debe validarla.
- La migración `202611110001_task_002_vehicle_staff` quedó aplicada en `mvp_transport_local`; el esquema de Prisma está en sincronía con esa base.
