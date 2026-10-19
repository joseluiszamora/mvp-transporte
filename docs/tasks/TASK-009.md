# TASK-009 — Archivos privados
Estado: implementada; en revisión técnica y aceptación funcional. Dependencias: 008. Issue GitHub: [#9](https://github.com/joseluiszamora/mvp-transporte/issues/9), abierta hasta aceptación del propietario.
## Contexto
Leer AGENTS.md y docs/product.md, architecture.md, data-model.md, security.md, access-matrix.md; consultar docs/modules/ relevantes. Criterios de módulo completan esta tarea.
## Objetivo y alcance
ADM-08 driver local, metadatos, políticas enlaces, upload/download y limpieza.
## Fuera de alcance
Distribución, móvil, suscripciones, Google, 2FA y despliegue productivo. No ampliar arquitectura sin decisión documentada.
## Criterios de aceptación
Archivos ajenos/personal inaccesibles; MIME/tamaño/traversal probados; volumen persistente.
Completar backend y UI descritos; manejar errores, estados vacíos/carga y autorización. No reportar como terminado si falta criterio; enumerar pendiente/bloqueo.
## Validación
Ejecutar checks raíz disponibles; tests integración en BD desechable para invariantes afectados. TASK-001 establece comandos. Adjuntar resultado real y prueba manual cuando UI cambie.
## Entrega
Código/migraciones/contratos, pruebas significativas, documentación actualizada. Commit identificable TASK-009. Estado técnico en revisión o integrado; aceptación funcional por propietario. Reportar riesgos y comandos exactos ejecutados.

## Evidencia técnica — 18/10/2026

- Implementados el driver local privado, metadatos/enlaces con integridad de tenant y scope, carga multipart en streaming, descargas autorizadas, eliminación con periodo de gracia, limpieza CLI y pantalla ADM-08.
- Solo se registran enlaces explícitos `COMPANY_ATTACHMENT` y `BRANCH_ATTACHMENT`. `EMPLOYEE_DOCUMENT` se rechaza hasta que ADM-05 aporte la entidad y su política; evita anticipar o debilitar el control de datos personales.
- Validaciones locales: `npm run lint`, `npm run typecheck`, `npm run test` (7/7), `npm run build` y `npm run test:integration`; pasaron. La integración desechable cubrió tenants ajenos, grants por empresa/sucursal, tipo personal no registrado, MIME/firma/extensión, tamaño máximo, nombres/rutas, descarga de bytes y la purga con archivos vinculados/no vinculados.
- La integración aplicó `20261016000200_task_009_files` únicamente a PostgreSQL desechable; el volumen de archivos también fue temporal. No se migró la base local persistente ni se desplegó producción.
- Pendiente: revisión técnica del PR y prueba manual de la UI; aceptación funcional reservada al propietario.
