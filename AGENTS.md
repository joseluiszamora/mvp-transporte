# Instrucciones para Codex
## Objetivo y fuentes
Construir una base administrativa independiente de diez módulos, reutilizable en instalaciones separadas. Leer docs/product.md, docs/architecture.md, docs/security.md, docs/data-model.md y la especificación del módulo antes de editar. Las tareas viven en docs/tasks/. Registrar decisiones en docs/decisions.md. No incluir distribución ni transporte en el núcleo.

## Autonomía
Implementar, validar, hacer commits e integrar tareas aprobadas dentro de su alcance. Trabajar en ramas task/NNN-descripcion; integrar solo después de checks y revisión técnica. Respetar reglas de protección de GitHub; no forzar pushes ni saltar checks. No desplegar producción, borrar datos reales ni ejecutar migraciones destructivas sin autorización explícita. Consultar cambios de alcance, modelo de acceso o decisiones aprobadas; resolver detalles menores según patrones existentes y documentarlos. No asumir que pasar checks equivale a aceptación funcional del propietario.
No enviar comunicaciones ni crear issues/comentarios externos sin instrucción explícita. Los archivos de tareas son plantillas; una vez el propietario autorice sincronizar GitHub Issues, crear y actualizar solo las relacionadas con este proyecto.

## Estructura y convenciones
Monorepo npm workspaces. apps/api, apps/web, packages/contracts, docs. Express con TS estricto; módulos con routes/controllers, services/use-cases y repositories. Validación en frontera, reglas en servicios y persistencia en repositorios. Prisma solo en backend. No crear paquetes genéricos innecesarios. Código y nombres técnicos en inglés; interfaz y documentación en español. Respuestas consistentes, paginación y límites en listas; fechas UTC, visualización America/La_Paz.
Toda lectura/escritura privada debe autorizar tenant, empresa, sucursal, permiso y estado de membresía según recurso. Nunca confiar en IDs del frontend. Evitar cambios fuera de la tarea y abstracciones prematuras.

## Validación
TASK-001 debe crear comandos reales de raíz: npm run lint, npm run typecheck, npm run test, npm run build; npm run test:integration para BD desechable. El README debe documentar migraciones, seed y arranque. Después, ejecutar los checks relevantes y reportar comando, resultado y limitaciones. Si un comando no existe, no inventar éxito: implementarlo si está en alcance o reportar bloqueo. No probar contra producción.
Tests prioritarios: aislamiento tenant/empresa/sucursal, permisos, revocación de sesión, concurrencia, archivos privados y cola de correo. No sustituir integración por mocks en pruebas de aislamiento.

## Entrega
Actualizar documentación y estado de la tarea; resumen de cambios, validaciones realizadas, pendientes y decisiones. Nunca registrar secretos, tokens o documentos personales en logs. .env.example contiene nombres y valores ficticios. Sin cuentas iniciales con contraseña pública fija.
