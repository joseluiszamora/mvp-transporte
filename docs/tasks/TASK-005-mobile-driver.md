# TASK-005 — Consulta móvil del conductor

**Estado:** En curso
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
- Selección de organización desde las opciones devueltas por mvp-base.
- Lista y detalle de viajes del conductor autenticado.
- Actualización permitida del estado e inicio/fin.
- Manejo claro de errores y confirmación de guardado.
- Almacenamiento seguro del refresh token y CSRF; access token solo en memoria.

## Criterios de aceptación

- El conductor solo consulta viajes asignados a él dentro de la empresa activa.
- La app permite solo iniciar un viaje asignado (`ASSIGNED` → `IN_PROGRESS`) y completarlo (`IN_PROGRESS` → `COMPLETED`); las fechas y el actor vienen del servidor.
- El refresh token y CSRF quedan en almacenamiento seguro del dispositivo; el access token vive en memoria.
- La app usa la API; no accede directamente a PostgreSQL.

## Dependencia de identidad resuelta en desarrollo — 2026-11-12

El propietario autorizó añadir en mvp-base una consulta propia. `GET /api/v1/employees/me` quedó implementado y validado en la rama `task/016-employee-self-context`, commit local `928d535`; devuelve solo IDs de empleado, organización y empresa activos desde el Bearer autenticado, sin recibir `employeeId` ni exigir permisos generales de lectura. No requiere migración. El commit aún no está publicado ni integrado en la rama principal de mvp-base.

La API de Transporte consume este contrato en servidor, deriva el perfil operativo propio de la empresa y filtra viajes por una asignación activa al conductor. La app nunca envía una identidad de empleado como evidencia. Cada operación requiere además `transport.driver_trips.read` o `transport.driver_trips.transition`; iniciar y completar requiere también `transport.audit.write` para la auditoría común.

La sesión móvil usa el mecanismo compartido de mvp-base y guarda los tokens rotativos en almacenamiento seguro del dispositivo. Los endpoints, el source Flutter de sesión, lista, detalle y transiciones, y los proyectos nativos Android/iOS están implementados. `flutter pub get` generó el lockfile y `flutter analyze` terminó sin incidencias. La compilación Android debug se detuvo en `mergeDebugNativeLibs` por falta de espacio; se eliminó el artefacto parcial generado. La compilación iOS requiere macOS con Xcode. También queda pendiente integrar TASK-016 en mvp-base.

El 2026-11-13, el propietario indicó posponer la compilación APK Android. Durante la revisión del flujo de autenticación se ajustó el callback de login para esperar la selección automática de organización y presentar sus errores en la pantalla de acceso.

## Próximos pasos

1. Revisar y publicar/integrar TASK-016 de mvp-base según su flujo aprobado.
2. Hacer el recorrido funcional tras integrar TASK-016: login, selección de organización, viajes y transiciones.
3. Compilar el APK Android cuando el propietario lo solicite; compilar iOS en macOS con Xcode.
4. Mantener actualizada la guía de ejecución y el manejo móvil de sesión.
