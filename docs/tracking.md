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
- TASK-004: integrada en `main` por PR #17, merge commit `642940f4e71358571a9facb0e2981c0aaa6c32b5`; CI run #10 aprobó lint, typecheck, unitarias, build e integración PostgreSQL. Issue #4 permanece abierta hasta aceptación funcional. La base persistente local no se usó.
- TASK-005: integrada en `main` por PR #18, merge commit `2aab75c03f86056a1f478d0d107029453b3cdf2`; CI run #12 aprobó validación. Issue #5 permanece abierta hasta aceptación funcional; no se aplicaron migraciones a la base persistente ni se desplegó producción.
- TASK-006: integrada en `main` mediante PR #19, merge commit `f2bf803746afd9158fdb5e3095512f576d94aeb1`; CI run #14 aprobó lint, typecheck, unitarias, build e integración PostgreSQL desechable. Issue #6 sigue abierta hasta aceptación funcional. No se aplicaron migraciones a una base persistente ni se desplegó producción.
- TASK-007: integrada en `main` por PR #20; Issue #7 sigue abierta hasta aceptación funcional del propietario. La base persistente local no se usó.

## Estado verificado 16/10/2026
- TASK-008: implementación completa en `task/008-configuracion`, depende de TASK-007 integrada por PR #20. Validaciones locales `lint`, `typecheck`, unitarias (7/7), build e integración con PostgreSQL 18/Mailpit desechables aprobadas. Issue #8 permanece abierta hasta aceptación funcional; revisión técnica y prueba manual pendientes. La migración nueva solo se aplicó a la base desechable; no se desplegó producción.

## Estado verificado 17/10/2026
- TASK-008: PR #23 abierto hacia `main`, CI aprobada; Issue #8 sigue abierta hasta aceptación funcional del propietario. TASK-009 parte de su commit en rama apilada y apuntará a la rama TASK-008 para no mezclar las dos entregas.
- TASK-009: implementación ADM-08 en `task/009-archivos`; Issue #9 abierta. Validaciones locales `lint`, `typecheck`, pruebas unitarias (7/7), build e integración PostgreSQL/Mailpit desechables correctas. La migración y volumen de archivos solo se usaron en recursos desechables. Revisión técnica, prueba manual de UI y aceptación funcional pendientes; producción y base persistente local no se tocaron.
- Política registrada: ADM-08 acepta adjuntos de empresa y sucursal con permiso de archivos más permiso del recurso. Enlaces a documentos personales se rechazan hasta que ADM-05 registre entidad y autorización.
