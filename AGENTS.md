# Instrucciones para trabajar en mvp-transporte

## Contexto del proyecto

mvp-transporte es el repositorio del producto de transporte. mvp-base es un repositorio independiente y la fuente oficial de administración, autenticación, empresas, personal, permisos, archivos, auditoría, configuración, notificaciones y catálogos.

Antes de modificar el código, inspecciona las instrucciones AGENTS.md aplicables, el estado de Git, la estructura real del repositorio, los package.json y el modo de integración con mvp-base.

## Estructura del código

- Mantén la API y la web dentro del monorepo mvp-transporte.
- Organiza la API como monolito modular bajo apps/api/src/modules.
- Organiza las pantallas por dominio bajo apps/web/src/modules.
- Conserva los límites entre módulos: un módulo consume contratos o servicios públicos de otro.
- Mantén packages/shared-contracts solo para tipos o contratos realmente compartidos por API y web.
- No dupliques el código, tablas, permisos ni reglas de mvp-base.
- No conviertas mvp-base en un workspace ni lo reorganices antes de inspeccionar si sus paquetes y dependencias lo permiten.
- No crees microservicios para los dominios actuales.

## Convenciones

- Backend: Node.js, Express y TypeScript; base de datos PostgreSQL y Prisma.
- Web: React, TypeScript y Vite, siguiendo el diseño y navegación de mvp-base.
- Móvil: Flutter, únicamente cuando se trabaje en la fase móvil.
- Usa TypeScript estricto y validación de entrada en los límites HTTP.
- Mantén reglas de negocio en servicios/casos de uso, no en componentes web ni controladores extensos.
- Usa nombres y errores coherentes con la convención ya adoptada por mvp-base.
- Conserva datos históricos; desactiva recursos operativos en vez de borrarlos si tienen viajes, documentos, mantenimiento o cargas.
- No incorpores arqueo de ayudantes, propietarios, flota, rutas reutilizables ni horarios fijos en la primera etapa.

## Multiempresa y seguridad

- Obtén empresa activa y permisos del contexto validado por la base.
- Valida en backend la pertenencia empresarial de cada entidad y relación.
- No confíes en companyId recibido desde el cliente como fuente de autorización.
- Protege archivos con las reglas del servicio de archivos compartido.
- No registres secretos, tokens, datos personales reales ni credenciales de GitHub.

## Base de datos

- Inspecciona el esquema y las migraciones de mvp-base antes de agregar modelos.
- Mantén migraciones incrementales y compatibles con la base.
- No edites migraciones ya aplicadas.
- Documenta el procedimiento de migración para la instalación combinada.
- Para documentos, relaciona archivos existentes; no crees un almacenamiento paralelo.
- Para combustible, cada carga debe pertenecer a un tanque configurado y registrar cantidad con su unidad.

## Validación y comandos

Antes de ejecutar validaciones, inspecciona los scripts disponibles en package.json y la guía del repositorio. Ejecuta únicamente comandos existentes y relevantes para los archivos modificados. Como candidatos, si están definidos:

- npm run lint
- npm run typecheck
- npm run build
- npm run db:validate o la validación Prisma documentada por el proyecto

No inventes comandos ni asumas que estos scripts están configurados. Si una validación no existe, indícalo.

## GitHub y entregas

- Vincula cada cambio con una tarea de docs/tasks o Issue de GitHub.
- Usa ramas cortas por tarea y Pull Requests hacia main, conforme a la configuración real del repositorio.
- Usa commits claros y enfocados.
- No publiques, despliegues, cambies permisos ni modifiques mvp-base desde mvp-transporte sin una tarea explícita.
- Actualiza documentación y criterios de aceptación junto con el comportamiento implementado.
