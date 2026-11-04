# Decisiones del proyecto

Registrar aquí decisiones aprobadas. Cada entrada debe incluir estado, fecha, decisión y motivo. Cambiar una decisión requiere explicar qué cambia y qué documentos deben actualizarse.

## ADR-001 — Repositorios separados

**Estado:** Aprobada  
**Fecha:** 2026-11-04

mvp-base y mvp-transporte son repositorios independientes. mvp-base es la fuente oficial de módulos comunes; mvp-transporte contiene los dominios de transporte. Esto permite mantener el sistema base reutilizable y el producto con ciclos de desarrollo separados.

## ADR-002 — Integración de mvp-base

**Estado:** Aprobada como estrategia condicional  
**Fecha:** 2026-11-04

Consumir paquetes versionados si mvp-base ya ofrece módulos importables. Mientras no existan esos paquetes, se puede fijar mvp-base como submódulo a un commit/tag. No copiar fuentes ni mantener dos implementaciones. Antes de implementar, inspeccionar ambos repositorios y documentar el mecanismo efectivo.

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
