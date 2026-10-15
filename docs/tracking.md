# Seguimiento GitHub Issues
GitHub Issues es la fuente de estado de ejecución; roadmap describe dependencias. Inicialmente todos los archivos son plantillas, no issues reales.
Crear una issue por TASK y enlazar la especificación; no duplicar. Labels sugeridas: foundation, module, security, blocked, needs-review. Estados: lista, en desarrollo, bloqueada, en revisión, aceptada. Dependencias explícitas en cuerpo; ramas task/NNN-slug; commits e integración referencian issue real una vez creada.
Codex puede integrar tareas que pasan checks dentro de autonomía acordada; issue permanece en revisión hasta aceptación funcional del propietario. No usar auto-close de issue si aceptación sigue pendiente. No afirmar checks ejecutados por CI si solo se ejecutaron localmente.
## Reporte por tarea
Implementado; criterios cumplidos/pendientes; comandos con resultado; pruebas manuales; decisión nueva; commit/PR real; siguiente dependencia disponible.
## Revisión del propietario
Probar flujo feliz, errores, usuario limitado, otra empresa/tenant; comparar criterio con evidencia. No aceptar por compilación solamente.
## Semana de revisión
Día 1: arranque/tenant; 2: login/sesiones; 3: roles/alcances; 4: catálogos/config; 5: personal/archivos; 6: SMTP/audit; 7: regresión/backup. Agenda aplicable cuando entregas estén disponibles; no exige implementar todo en esa semana.

## Estado verificado 15/10/2026
- TASK-001: aceptación funcional confirmada por el propietario; PR #14 integrado en `main`, CI aprobada y issue #1 cerrada.
- TASK-002: PR #15 integrado en `main` con CI aprobada; issue #2 abierta hasta aceptación funcional. La integración de TASK-003 usa una base desechable y no aplica migraciones a producción ni a la base persistente local.
- TASK-003: entrega registrada en PR #16; validaciones locales y CI remota aprobadas. Issue #3 abierta hasta aceptación funcional del propietario.
- TASK-004: rama `task/004-autenticacion-alta` parte del merge real `8546fb0` (PR #16). Implementación y validaciones locales en revisión técnica; issue #4 abierta y aceptación funcional pendiente. Integración probó autenticación contra PostgreSQL/Mailpit desechables; no se usó la base local persistente. Pendiente registrar commit/PR y CI remota tras publicar la rama; falta prueba manual de pantallas y varias pestañas.
