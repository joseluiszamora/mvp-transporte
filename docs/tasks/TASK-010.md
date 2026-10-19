# TASK-010 — Personal
Estado: implementación local en `task/010-personal`; revisión técnica pendiente de integración con Docker; aceptación funcional pendiente del propietario. Dependencias: 009. Issue GitHub: [#10](https://github.com/joseluiszamora/mvp-transporte/issues/10).

## Contexto
Leer AGENTS.md, docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md y docs/modules/ADM-05.md. Las decisiones aprobadas prevalecen.

## Objetivo y alcance
Implementar ADM-05: CRUD laboral, datos personales restringidos, vínculo opcional con usuario, foto y documentos privados. Mantener el aislamiento por organización, empresa y sucursal.

## Criterios técnicos
- Los empleados pueden existir sin una cuenta vinculada; el vínculo requiere una membresía de la misma organización y no concede acceso a la aplicación.
- Listados, detalle y mutaciones se autorizan contra la organización y los alcances actuales; los campos personales y archivos requieren permisos específicos.
- Un supervisor sin permisos personales/documentales solo ve información laboral; un permiso de sucursal permite administrar únicamente asignaciones en sucursales autorizadas.
- La UI incluye estados de carga, vacío y error, y muestra acciones según capacidades devueltas por la API.
- Migración, contratos OpenAPI, pruebas de integración y documentación reflejan el modelo.

## Validación local — 18/10/2026
- `npm run lint`: pasó (68 archivos).
- `npm run typecheck`: pasó.
- `npm run test`: pasó (7/7).
- `npm run build`: pasó; Vite advirtió que el bundle supera 500 kB.
- `npm run test:integration`: no ejecutada porque el daemon de Docker no estaba disponible (`dockerDesktopLinuxEngine` pipe ausente). No se usó la base persistente local.
- Prueba manual de UI: pendiente del propietario.

## Pendientes
Repetir `npm run test:integration` con Docker Desktop en ejecución; revisar CI tras publicar la rama; prueba manual autenticada y aceptación funcional del propietario. No cerrar la Issue #10 hasta esa aceptación.

## Entrega
Código, migración, contratos, UI y documentación en la rama `task/010-personal`. La entrega se apila sobre la rama de TASK-009 mientras su PR sigue abierto. Registrar el SHA/PR y resultados finales tras completar integración. No desplegar producción.