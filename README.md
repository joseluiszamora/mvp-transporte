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

## Migraciones y seed

TASK-001 no crea todavía el modelo de negocio, migraciones ni cuentas iniciales. TASK-002 añadirá el esquema Prisma y los comandos de migración; las tareas posteriores definirán datos de desarrollo seguros. No existe una cuenta inicial con contraseña fija.

Cuando se incorporen migraciones y seed, sus comandos se documentarán aquí y solo deberán ejecutarse contra una base local o desechable. No apuntes los comandos de validación a producción.

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

La readiness no devuelve datos de conexión ni mensajes internos. El shell solo consulta health/readiness y muestra los diez módulos como pendientes; no ofrece acceso simulado ni datos privados. La autenticación, autorización, migraciones y módulos se implementarán en las tareas del roadmap.
