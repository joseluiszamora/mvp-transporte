# Base administrativa independiente

Monorepo para una base administrativa reutilizable en instalaciones y bases de datos separadas. La primera entrega prepara API, shell web y servicios locales; no incluye distribución, transporte ni módulos de negocio terminados.

## Requisitos

- Node.js 24 LTS y npm 11.
- Docker Engine o Docker Desktop con Docker Compose.

## Instalación y arranque local

1. Copia `.env.example` a `.env`. Los valores incluidos son ficticios y sirven solo para desarrollo local.
2. Instala dependencias con `npm ci`.
3. Inicia PostgreSQL y Mailpit con `docker compose up -d`.
4. En una terminal, inicia la API con `npm run dev:api`.
5. En otra terminal, inicia la web con `npm run dev:web`.

La API queda en `http://127.0.0.1:4000`; su health check es `/api/v1/health`, readiness es `/api/v1/ready` y OpenAPI se sirve en `/api/v1/openapi.json`. La web queda en `http://127.0.0.1:5173`. Mailpit usa `http://127.0.0.1:8025` para su bandeja y `127.0.0.1:1025` para SMTP.

Si todavía no configuraste PostgreSQL, la API puede iniciar sin `DATABASE_URL`: health responde normalmente y readiness devuelve `503` hasta que la conexión esté disponible. No hace falta configurar una base real para revisar el shell web.

## Prisma, migraciones y fixtures

TASK-002 mantiene el esquema en `apps/api/prisma/schema.prisma` y las migraciones versionadas en `apps/api/prisma/migrations/`. Prisma lee `DATABASE_URL` del entorno o del `.env` en la raíz.

```sh
npm run db:generate
npm run db:migrate:dev
npm run db:migrate:deploy
npm run db:seed
```

`db:migrate:dev` crea y aplica migraciones durante el desarrollo local. `db:migrate:deploy` aplica migraciones ya creadas; úsalo solo contra desarrollo o una base de pruebas. Ningún comando local debe apuntar a producción.

`db:seed` solo funciona con `NODE_ENV=development` o con el entorno de prueba marcado por el script de integración, y exige un host PostgreSQL local. Crea dos tenants, empresas, sucursales, usuarios de fixture pendientes de activación y los cuatro roles iniciales. No fija ni muestra contraseñas; los usuarios no pueden iniciar sesión hasta completar activación.

`npm run test:integration` inicia una instancia Compose desechable en `tmpfs`, aplica las migraciones, carga los fixtures y verifica las restricciones de tenant, scope y sesión. Al finalizar elimina ese proyecto temporal sin tocar la base local persistente.

## Validaciones

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

La integración crea un proyecto Compose temporal y monta los datos de PostgreSQL en `tmpfs`; al finalizar elimina ese proyecto sin tocar la base local persistente.

## Seguridad y estado

La readiness no devuelve datos de conexión ni mensajes internos. El shell solo consulta health/readiness y muestra los diez módulos como pendientes; no ofrece acceso simulado ni datos privados. La autorización ya tiene servicios base de contexto y scope; las rutas y pantallas funcionales siguen en tareas posteriores.
