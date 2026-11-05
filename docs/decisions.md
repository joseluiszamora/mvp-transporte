# Decisiones del proyecto

Registrar aquí decisiones aprobadas. Cada entrada debe incluir estado, fecha, decisión y motivo. Cambiar una decisión requiere explicar qué cambia y qué documentos deben actualizarse.

## ADR-001 — Repositorios separados

**Estado:** Aprobada · **Fecha:** 2026-11-04

mvp-base y mvp-transporte son repositorios independientes. mvp-base es la fuente oficial de módulos comunes; mvp-transporte contiene los dominios de transporte. Esto permite mantener el sistema base reutilizable y el producto con ciclos de desarrollo separados.

## ADR-002 — Integración de mvp-base

**Estado:** Aprobada como estrategia condicional  
**Fecha:** 2026-11-04

Consumir paquetes versionados si mvp-base ya ofrece módulos importables. Mientras no existan esos paquetes, se puede fijar mvp-base como submódulo a un commit/tag. No copiar fuentes ni mantener dos implementaciones. Antes de implementar, inspeccionar ambos repositorios y documentar el mecanismo efectivo.

### Resolución inicial de integración — 2026-11-04

- Se agrega `mvp-base` como submódulo Git en `mvp-base/`, remoto `git@github.com:joseluiszamora/mvp-base.git`, fijado al commit `52f2e449dcf3a8109481fed55117327f1bd59b38` de `main`.
- Se elige el submódulo porque el repositorio base y `@mvp-base/contracts` son privados; los contratos forman parte del workspace npm interno y no se encontró una distribución versionada separada para consumir desde este repositorio.
- Para clonar mvp-transporte con la referencia inicializada, ejecutar `git submodule update --init --recursive`.
- Para actualizar la referencia, revisar primero el nuevo commit de `main` en mvp-base; luego ejecutar `git -C mvp-base fetch origin main`, `git -C mvp-base checkout <commit-revisado>` y `git add mvp-base` desde la raíz de mvp-transporte. El cambio queda registrado como una nueva referencia del submódulo en el commit de mvp-transporte.
- Esta decisión fija el código fuente, pero no conecta todavía la API, los contratos de ejecución ni las migraciones de base de datos. Esos contratos deben verificarse antes de implementar módulos de transporte.

## ADR-003 — Arquitectura modular

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Usar un monolito modular en Express/TypeScript y PostgreSQL/Prisma, con web React/TypeScript/Vite. La app Flutter se incorpora después de estabilizar la API. Se evita distribuir prematuramente el producto en microservicios.

## ADR-004 — Personal compartido

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Los conductores y ayudantes son perfiles operativos ligados al empleado de mvp-base. Una persona puede tener ambos perfiles. La decisión evita duplicar identidad, contactos y auditoría.

## ADR-005 — Viajes iniciales

**Estado:** Aprobada  
**Fecha:** 2026-11-04

El sistema contempla distribución, ruta corta y viaje largo. Los viajes cortos guardan una o dos paradas sin catálogo de rutas; los viajes largos pueden durar varios días y permiten relevos de conductor.

## ADR-006 — Ayudantes de distribución

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Distribución requiere uno o dos ayudantes totales. Pueden ser empleados propios o ser proporcionados por el cliente. El registro distingue el origen y permite nombre opcional para una persona externa. El arqueo de ayudantes queda fuera de alcance.

## ADR-007 — Documentos y avisos

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Documentación almacena archivo y fechas de emisión/vencimiento/renovación usando el servicio compartido de archivos. Las notificaciones automáticas se conectarán en una fase posterior.

## ADR-008 — Combustible por tanque

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Un vehículo puede tener tanque de gasolina y de GNV. Cada carga pertenece a un tanque y se reporta con tipo y unidad para mantener separados los volúmenes. Los costos monetarios sí admiten consolidación.

## ADR-009 — Módulos diferidos

**Estado:** Aprobada  
**Fecha:** 2026-11-04

Propietarios, flota, rutas reutilizables, horarios fijos, GPS y arqueo quedan fuera del alcance inicial porque aún no son necesarios o sus reglas no están definidas.

## ADR-010 — Módulos de mvp-base para la integración inicial

**Estado:** Aprobada · **Fecha:** 2026-11-04

La integración de mvp-transporte utilizará ADM-01 Empresas y sucursales para el contexto organizativo; ADM-02 Usuarios para la identidad de operadores y autores de acciones; ADM-03 Autenticación para sesiones y credenciales; ADM-04 Roles y permisos para autorización por empresa; ADM-05 Personal como fuente de identidad de conductores y ayudantes; ADM-06 Configuración para preferencias y parámetros; ADM-07 Auditoría para registrar cambios relevantes; ADM-08 Archivos para documentos, comprobantes y evidencias; ADM-09 Notificaciones para la integración de avisos; y ADM-10 Catálogos para valores compartidos. La automatización de avisos documentales permanece diferida según ADR-007. mvp-base continúa como fuente de verdad y mvp-transporte no duplica sus módulos.

## ADR-011 — Límite de ejecución y datos con mvp-base

**Estado:** Aprobada · **Fecha:** 2026-11-05

mvp-transporte y mvp-base se ejecutan como aplicaciones independientes y se integran mediante APIs HTTP públicas. Cada producto conserva su propia base PostgreSQL y su historial de migraciones: mvp-base administra el esquema de plataforma; mvp-transporte administra sus modelos de transporte y guarda IDs externos para organización, empresa, sucursal, empleado y archivo. No se importan internals del submódulo ni se consulta directamente su base.

La decisión mantiene repositorios, despliegues y migraciones independientes, como permite la estructura real de mvp-base, y evita una historia Prisma duplicada o una segunda implementación de las reglas de plataforma. Un endpoint de Transporte solo puede autorizarse cuando mvp-base valide la sesión del actor y su permiso en el alcance objetivo. Los IDs del cliente no son evidencia de autorización.

La revisión fijada aún no ofrece el contexto de permisos con alcance para códigos `transport.*`, un contrato de escritura de auditoría ni tipos de archivo para vehículos. TASK-007 registra esa extensión como dependencia externa. No se habilitarán escrituras de Transporte hasta que se integre.
