# Referencia a módulos ADM de mvp-base

## Propósito

Identificar las dependencias de plataforma usadas por mvp-transporte. Esta ficha resume las interfaces verificadas; la documentación funcional vigente de cada ADM se mantiene en el repositorio mvp-base.

La tabla de interfaces de esta ficha describe `main` de mvp-base en `52f2e449dcf3a8109481fed55117327f1bd59b38`. El submódulo de la rama actual apunta al candidato `8435ec91e8c8e2370684904afd4bc8df0bda737d`; el PR #37 continúa el trabajo hasta `9331064`, con corrección de alcance y regresión, y aún no está integrado en `main`. La integración de ejecución y el estado de ambas revisiones se documentan en [docs/integration/mvp-base.md](../integration/mvp-base.md).

## Módulos seleccionados

| Módulo base | Uso desde mvp-transporte |
|---|---|
| ADM-01 Empresas y sucursales | Referencias organizativas y validación del alcance empresarial |
| ADM-02 Usuarios | Identidad de operadores y autores de acciones |
| ADM-03 Autenticación | Sesiones y credenciales de acceso |
| ADM-04 Roles y permisos | Autorización por organización, empresa y sucursal |
| ADM-05 Personal | Fuente de identidad de conductores y ayudantes |
| ADM-06 Configuración | Preferencias compartidas y parámetros de instalación |
| ADM-07 Auditoría | Registro de cambios relevantes |
| ADM-08 Archivos | Documentos, comprobantes y evidencias |
| ADM-09 Notificaciones | Integración futura; avisos documentales automáticos diferidos según ADR-007 |
| ADM-10 Catálogos | Valores compartidos cuando correspondan |

La selección no duplica tablas, permisos ni reglas de mvp-base y no compromete toda su funcionalidad en la primera fase.

## Interfaces verificadas

| Capacidad | Interfaz disponible | Estado para Transporte |
|---|---|---|
| Autenticación | `POST /api/v1/auth/login`, `/refresh`, `/select-organization`; `GET /api/v1/auth/me` | Reutilizable para sesión. `/auth/me` devuelve organización seleccionada y códigos de permiso planos, no alcances por empresa/sucursal. |
| Empresas y sucursales | APIs `/api/v1/organizations/companies` y `/branches` | Reutilizables según permisos del actor. La sesión selecciona organización, no empresa activa. |
| Personal | `GET /api/v1/employees`, `GET /api/v1/employees/{employeeId}`, APIs de documentos y foto | Fuente de identidad reutilizable; perfiles de transporte se guardan en Transporte y referencian IDs externos. |
| Archivos | `/api/v1/files`, `/api/v1/files/{fileId}`, `/content` | Protege archivos privados de tipos existentes. No contempla vehículo ni comprobante de combustible como tipo de recurso. |
| Auditoría | `GET /api/v1/audit`, `GET /api/v1/audit/{eventId}` | Consulta disponible. La escritura está encapsulada en los servicios internos; no hay API pública de ingreso para eventos de Transporte. |
| Catálogos | `/api/v1/catalogs` | Reutilizar catálogos existentes cuando correspondan. |
| Configuración | `/api/v1/settings` | Reutilizar valores compartidos; evitar duplicar configuración de plataforma. |
| Notificaciones | `/api/v1/notifications` | Mantener fuera de la primera integración de vencimientos según ADR-007. |
| Contratos TypeScript | Workspace privado `@mvp-base/contracts` | Incluye tipos de API; no ofrece cliente, middleware o SDK importable por este repositorio. |

La especificación OpenAPI está disponible en `/api/v1/openapi.json`. Las rutas actuales están montadas por la aplicación de mvp-base. No se debe importar `mvp-base/apps/api/src/**` para suplir contratos públicos que faltan.

## Contrato candidato pendiente de integración

El candidato `8435ec91` implementa en mvp-base la extensión requerida por TASK-007 bajo el identificador TASK-015:

- Autenticación del servicio consumidor y revalidación de sesión/membresía del usuario.
- Registro de permisos `transport.*` y autorización contextual por empresa/sucursal.
- Archivos privados asociados a recursos externos, sujetos a permisos comunes y específicos.
- Ingreso autenticado de auditoría con actor y alcance derivados de Base.

CI runs 56, 57 y 59 pasaron; el último corresponde a la cabeza `9331064` e incluye la regresión del aislamiento por empresa y sucursal. El PR #37 está listo para revisión independiente; hasta que se fusione a `main` de mvp-base, no habilitar escrituras ni depender de esta interfaz como contrato estable. La [guía candidata de APIs de producto](https://github.com/joseluiszamora/mvp-base/blob/933106429797d5d488279758ca3763c6e43d66da/docs/integration/product-apis.md) contiene los endpoints y esquemas concretos.
