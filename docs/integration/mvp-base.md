# Integración con mvp-base

## Revisión fijada

La referencia local es el commit `52f2e449dcf3a8109481fed55117327f1bd59b38` del repositorio privado `mvp-base`. La referencia se actualiza como cambio de submódulo, después de revisar y fijar un commit integrado en `main`.

## Límite de ejecución

`mvp-transporte` y `mvp-base` se ejecutan como aplicaciones independientes y se comunican por HTTP. Transporte no importa archivos de `mvp-base/apps/**/src`, no instala sus workspaces como si fueran paquetes públicos y no consulta directamente sus tablas.

Cada producto administra su propia base PostgreSQL y su historial de migraciones. La base administra los modelos de plataforma; Transporte almacena sus propios modelos y conserva los IDs de organización, empresa, sucursal, empleado y archivo como referencias externas. Un ID recibido del cliente identifica un recurso solicitado, pero nunca autoriza la operación por sí mismo.

La web de Transporte autenticará y renovará sesiones mediante mvp-base. En cada operación de Transporte, el backend deberá validar la sesión y el alcance del actor con una interfaz pública de mvp-base. No deberá verificar localmente el JWT ni confiar en `companyId`, `organizationId`, permisos o identidad enviados en headers o en el cuerpo.

## Capacidades verificadas en el commit fijado

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

## Contrato requerido antes de datos de transporte

TASK-007 especifica el trabajo que debe hacerse en mvp-base:

1. Validar un token en curso y devolver contexto confiable de usuario, organización y membresía, junto con permisos y alcances por empresa/sucursal para códigos registrados por el producto de transporte. La revocación o suspensión de sesión/membresía debe reflejarse en esa validación.
2. Permitir registrar permisos `transport.*` mediante una extensión pública y mantener su administración dentro del módulo común de permisos.
3. Autorizar y asociar archivos a recursos de Transporte, incluidos vehículos, y conservar la protección de descarga y el aislamiento empresarial.
4. Aceptar eventos de auditoría de Transporte mediante un contrato autenticado que establezca actor, organización, recurso, acción y validación de alcance.

Hasta que ese contrato esté implementado y versionado en mvp-base, no se deben exponer endpoints de escritura de Transporte ni llamar a código interno de mvp-base para sortear la frontera. Los módulos independientes pueden seguir avanzando en especificación.

## Instalación y migraciones

El README raíz prepara y valida el estado actual ejecutable de mvp-base. Su base de datos, archivos privados y migraciones permanecen bajo el control de mvp-base. Cuando Transporte tenga aplicación, usará una base y migraciones propias; la instalación combinada iniciará ambos servicios y aplicará las migraciones de cada proyecto por separado. No se debe ejecutar una carpeta de migraciones de Prisma contra una base que también contiene el historial de migraciones del otro repositorio.

## Actualizar el submódulo

1. Revisar el cambio en mvp-base y confirmar que el contrato público requerido está integrado en su rama principal.
2. Cambiar la referencia del submódulo al commit revisado.
3. Actualizar esta ficha, [TASK-001](../tasks/TASK-001-integrate-mvp-base.md), la documentación de arquitectura y los comandos que hayan cambiado.
4. Ejecutar las validaciones relevantes de ambos repositorios y registrar los resultados en la tarea.
