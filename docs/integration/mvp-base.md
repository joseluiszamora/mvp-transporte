# Integración con mvp-base

## Revisión fijada

El submódulo de esta rama queda fijado al commit integrado `97c5840211e593a9fd91775fe30383a173feeb35` de `main` de mvp-base. El [PR #37](https://github.com/joseluiszamora/mvp-base/pull/37) se fusionó después de la aceptación funcional y la revisión técnica.

La revisión corrigió en `4804ee4` el filtro de empresa y sucursal del listado de archivos externos; `9331064` añadió una regresión para otros alcances. CI run 59 pasó con esa corrección y CI run 60 pasó tras actualizar el seguimiento de TASK-015.

## Límite de ejecución

`mvp-transporte` y `mvp-base` se ejecutan como aplicaciones independientes y se comunican por HTTP. Transporte no importa archivos de `mvp-base/apps/**/src`, no instala sus workspaces como si fueran paquetes públicos y no consulta directamente sus tablas.

Cada producto administra su propia base PostgreSQL y su historial de migraciones. La base administra los modelos de plataforma; Transporte almacena sus propios modelos y conserva los IDs de organización, empresa, sucursal, empleado y archivo como referencias externas. Un ID recibido del cliente identifica un recurso solicitado, pero nunca autoriza la operación por sí mismo.

La web de Transporte autenticará y renovará sesiones mediante mvp-base. En cada operación de Transporte, el backend deberá validar la sesión y el alcance del actor con una interfaz pública de mvp-base. No deberá verificar localmente el JWT ni confiar en `companyId`, `organizationId`, permisos o identidad enviados en headers o en el cuerpo.

## Capacidades base verificadas en `52f2e449`

| Capacidad | Interfaz disponible | Límite para Transporte |
|---|---|---|
| Autenticación | `POST /api/v1/auth/login`, `/refresh`, `/select-organization`; `GET /api/v1/auth/me` | `/auth/me` devuelve organización seleccionada y códigos de permisos sin sus alcances por organización, empresa o sucursal. El token contiene usuario, sesión y membresía seleccionada; no incluye concesiones de permiso. |
| Empresas y sucursales | Rutas de `/api/v1/organizations/companies` y `/branches` | No existe un selector de empresa activa en la sesión. Los recursos de Transporte deberán autorizarse contra la empresa objetivo mediante contexto validado por mvp-base. |
| Personal | `GET /api/v1/employees`, `GET /api/v1/employees/{id}` y documentos | Se puede reutilizar el personal existente; Transporte no crea otra tabla de empleados. Las verificaciones se hacen con la API y el token del actor. |
| Archivos | `/api/v1/files` y endpoints de documentos de empleado | Los tipos aceptados son empresa, sucursal y empleado. No existe un tipo ni una autorización para documentos de vehículos. |
| Auditoría | `GET /api/v1/audit` y `GET /api/v1/audit/{id}` | La escritura se realiza dentro de servicios internos de mvp-base; no hay endpoint público para registrar eventos de Transporte. |
| Catálogos y configuración | APIs de catálogos y configuración | Reutilizar cuando el dato pertenezca a la plataforma; los catálogos específicos del dominio se acuerdan con mvp-base antes de duplicarlos. |
| Contratos TypeScript | `@mvp-base/contracts` dentro del workspace npm privado | Publica tipos de request/response, no un cliente de API, middleware de sesión o paquete de servicios para integrar en otro repo. |

La API expone su documento OpenAPI en `/api/v1/openapi.json`. La aplicación y las rutas están compuestas dentro de `mvp-base/apps/api`; el paquete de contratos no proporciona un punto de extensión para montar módulos de Transporte.

## Contrato de producto integrado en `97c5840`

El PR #37 integró en mvp-base la tarea `TASK-015`, equivalente a TASK-007 de Transporte. El contrato ofrece autenticación de servicio mediante `X-MVP-Integration-Key` y revalidación del usuario con Bearer en cada operación; registro de permisos namespaced; autorización contextual por empresa/sucursal; manejo privado de archivos para recursos externos; y escritura de auditoría con actor y alcance derivados por Base. Base verifica que empresa y sucursal existan en la organización y evalúa el permiso, pero no demuestra que el ID de recurso externo pertenezca a ese alcance. La API de Transporte debe cargar su propio recurso y derivar empresa/sucursal desde su base antes de invocar Base; no debe confiar en valores del navegador. Los detalles están en la [guía de APIs de producto de mvp-base](https://github.com/joseluiszamora/mvp-base/blob/97c5840211e593a9fd91775fe30383a173feeb35/docs/integration/product-apis.md) y en [TASK-015](https://github.com/joseluiszamora/mvp-base/blob/97c5840211e593a9fd91775fe30383a173feeb35/docs/tasks/TASK-015.md).

CI runs 56, 57, 59 y 60 pasaron. El propietario aceptó el contrato y mvp-base lo integró en `main` mediante `97c5840`.

## Requisitos antes de habilitar datos de transporte

El contrato está integrado en Base. Al implementar operaciones de Transporte, la API deberá:

1. Validar un token en curso y devolver contexto confiable de usuario, organización y membresía, junto con permisos y alcances por empresa/sucursal para códigos registrados por el producto de transporte. La revocación o suspensión de sesión/membresía debe reflejarse en esa validación.
2. Permitir registrar permisos `transport.*` mediante una extensión pública y mantener su administración dentro del módulo común de permisos.
3. Autorizar y asociar archivos a recursos de Transporte, incluidos vehículos, y conservar la protección de descarga y el aislamiento empresarial.
4. Aceptar eventos de auditoría de Transporte mediante un contrato autenticado que establezca actor, organización, recurso, acción y validación de alcance.

La integración con Base ya está lista, pero mvp-transporte todavía no tiene API propia. Sus futuras escrituras deben usar este contrato público y no importar código interno ni consultar las tablas de mvp-base.

## Instalación y migraciones

El README raíz prepara y valida el estado actual ejecutable de mvp-base. Su base de datos, archivos privados y migraciones permanecen bajo el control de mvp-base. Cuando Transporte tenga aplicación, usará una base y migraciones propias; la instalación combinada iniciará ambos servicios y aplicará las migraciones de cada proyecto por separado. No se debe ejecutar una carpeta de migraciones de Prisma contra una base que también contiene el historial de migraciones del otro repositorio.

## Actualizar el submódulo

1. Revisar el cambio en mvp-base y confirmar que el contrato público requerido está integrado en su rama principal.
2. Cambiar la referencia del submódulo al commit revisado.
3. Actualizar esta ficha, [TASK-001](../tasks/TASK-001-integrate-mvp-base.md), la documentación de arquitectura y los comandos que hayan cambiado.
4. Ejecutar las validaciones relevantes de ambos repositorios y registrar los resultados en la tarea.
