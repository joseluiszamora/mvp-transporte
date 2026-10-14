# ADM-08 — Archivos
## Entidades
File, FileLink.
## Reglas y alcance
Almacenamiento privado persistente; API streaming autorizado. Límite inicial 10MiB; PDF JPEG PNG WEBP, validar MIME real y extensión; no HTML/SVG/ejecutables iniciales. Claves aleatorias, prevenir traversal, no confiar nombre. ResourceLink usa registro de tipos con políticas explícitas; no referencias arbitrarias. Limpieza de huérfanos con periodo de gracia.
## Panel web
Upload con progreso/error, foto y adjuntos, descarga controlada.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Traversal/MIME inconsistente/tamaño excessivo rechazados; archivo ajeno inaccesible; permiso genérico no evita política del recurso; limpieza no borra archivos vinculados.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
