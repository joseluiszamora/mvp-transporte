# ADM-07 — Auditoría
## Entidades
AuditEvent.
## Reglas y alcance
Registro append-only de acciones sensibles y cambios relevantes en transacción. Actor sistema explícito. Sanitizar before/after; no documentos completos ni contraseñas/tokens. Auditar sesiones sin credenciales. Sin edición/borrado por UI ni purga automática: el propietario aprobó conservar todos los eventos. Cualquier futura política de retención requiere una nueva decisión explícita.
## Panel web
Listado con filtros fecha/actor/recurso y detalle filtrado por alcance.
Listas paginadas, filtros, carga/vacío/error, validación; botones dependen de permisos efectivos sin reemplazar backend.
## API
Contrato /api/v1 definido en OpenAPI en la tarea: esquemas, validaciones, scopes, errores y respuestas. No exponer ORM ni campos restringidos. Recurso inaccesible puede responder 404 para evitar enumeración; falta de permiso conocido 403.
## Aceptación
Evento persistido con mutación exitosa; rollback no genera falso cambio; tenant ajeno inaccesible; secretos excluidos.
## Validación transversal
Dos tenants; varias empresas; sucursales permitidas y prohibidas; usuario sin permiso. Registrar mutaciones sensibles y documentar cambios.
