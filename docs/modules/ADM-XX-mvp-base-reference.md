# Referencia a módulos ADM de mvp-base

## Propósito

Identificar las dependencias de plataforma usadas por mvp-transporte. Este archivo no replica reglas de negocio ni especificaciones internas de mvp-base. La documentación vigente de cada ADM se mantiene en el repositorio mvp-base.

## Módulos confirmados para mvp-transporte

| Módulo base | Uso desde mvp-transporte |
|---|---|
| ADM-01 Empresas y sucursales | Contexto empresarial y asignación organizativa de recursos |
| ADM-02 Usuarios | Identidad de operadores y autores de acciones |
| ADM-03 Autenticación | Sesiones y credenciales de acceso |
| ADM-04 Roles y permisos | Autorización por empresa |
| ADM-05 Personal | Fuente de identidad de conductores y ayudantes |
| ADM-06 Configuración | Preferencias compartidas y parámetros de instalación |
| ADM-07 Auditoría | Registro de cambios relevantes |
| ADM-08 Archivos | Documentos, comprobantes y evidencias |
| ADM-09 Notificaciones | Integración para notificaciones; la automatización de avisos documentales se difiere según ADR-007 |
| ADM-10 Catálogos | Valores compartidos cuando correspondan |

Los diez módulos ADM quedan seleccionados como dependencias de mvp-transporte. La selección no significa que toda su funcionalidad se entregue en la primera fase; por ejemplo, la automatización de avisos documentales se mantiene diferida según ADR-007. mvp-transporte conservará mvp-base como fuente de verdad y no duplicará sus tablas, permisos ni reglas.

## Contratos que deben verificarse al integrar

- Cómo se obtiene la empresa activa y la membresía del usuario.
- Cómo se consultan empleados y se vinculan a perfiles de transporte.
- Cómo se exige un permiso para una operación por empresa.
- Si el contexto de empresa se obtiene a través de ADM-04 o requiere consumo directo de ADM-01.
- Cómo se suben, consultan y protegen archivos.
- Cómo se registran eventos de auditoría.
- Cómo se consultan preferencias compartidas y catálogos aplicables a transporte.
- Qué eventos o plantillas utilizará la integración futura de notificaciones.
- Quién administra el esquema Prisma y cómo se despliegan migraciones.

No inventar endpoints, nombres de permisos, campos o comandos. Leerlos desde mvp-base durante la tarea TASK-001.
