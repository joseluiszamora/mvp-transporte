# Referencia a módulos ADM de mvp-base

## Propósito

Identificar las dependencias de plataforma usadas por mvp-transporte. Este archivo no replica reglas de negocio ni especificaciones internas de mvp-base. La documentación vigente de cada ADM se mantiene en el repositorio mvp-base.

## Dependencias

| Módulo base | Uso desde mvp-transporte |
|---|---|
| ADM-01 Empresas y sucursales | Contexto empresarial y posible asignación organizativa de recursos |
| ADM-02 Usuarios | Identidad de operadores y autores de acciones |
| ADM-03 Autenticación | Sesiones y credenciales de acceso |
| ADM-04 Roles y permisos | Autorización por empresa |
| ADM-05 Personal | Fuente de identidad de conductores y ayudantes |
| ADM-06 Configuración | Preferencias compartidas y parámetros de instalación |
| ADM-07 Auditoría | Registro de cambios relevantes |
| ADM-08 Archivos | Documentos, comprobantes y evidencias |
| ADM-09 Notificaciones | Integración futura para alertas documentales |
| ADM-10 Catálogos | Valores compartidos cuando correspondan |

## Contratos que deben verificarse al integrar

- Cómo se obtiene la empresa activa y la membresía del usuario.
- Cómo se consultan empleados y se vinculan a perfiles de transporte.
- Cómo se exige un permiso para una operación por empresa.
- Cómo se suben, consultan y protegen archivos.
- Cómo se registran eventos de auditoría.
- Quién administra el esquema Prisma y cómo se despliegan migraciones.

No inventar endpoints, nombres de permisos, campos o comandos. Leerlos desde mvp-base durante la tarea TASK-001.
