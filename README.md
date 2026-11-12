# mvp-transporte

Producto de transporte que usa mvp-base para identidad, empresas, permisos, personal, archivos, auditoría, configuración y catálogos. La primera entrega vertical implementa vehículos y perfiles de personal operativo en una API y una web propias.

## Estado actual

- `mvp-base/` es un submódulo fijado al commit registrado en [las decisiones del proyecto](docs/decisions.md).
- mvp-base y Transporte se comunican por HTTP y conservan bases y migraciones separadas.
- El contrato de autorización por alcance, auditoría y archivos externos quedó integrado en `main` de mvp-base en `97c5840`; el submódulo está fijado a esa revisión. CI runs 59 y 60 pasaron tras corregir el aislamiento de archivos. Transporte registra permisos al arrancar y valida cada operación con Base.
- TASK-002 desarrolla vehículos con capacidad en kg y perfiles de conductor/ayudante ligados a Employee. La API no duplica identidad ni tablas de mvp-base.

## Requisitos

- Node.js 24 y npm 11.
- Docker Engine o Docker Desktop con Docker Compose.
- Git con acceso al repositorio privado de mvp-base.

## Preparar el entorno local

Desde una clonación existente, inicializa el submódulo y sus dependencias:

```sh
git submodule update --init --recursive
npm run setup:base
npm install
```

Copia `mvp-base/.env.example` a `mvp-base/.env` y `.env.example` a `.env` en la raíz de Transporte. Configura credenciales locales ficticias para ambos productos. En `mvp-base/.env`, define la clave `transport` en `MVP_INTEGRATION_SECRETS_JSON` con el mismo valor de `MVP_BASE_INTEGRATION_KEY`, y añade `http://localhost:5174` a `WEB_ORIGINS`. Genera una clave aleatoria de 32 bytes para desarrollo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; nunca uses secretos de producción en esta instalación.

Inicia PostgreSQL y Mailpit de mvp-base según su configuración local:

```sh
docker compose --env-file mvp-base/.env -f mvp-base/compose.yaml up -d
```

Inicia la base independiente de Transporte desde esta raíz:

```sh
docker compose up -d
```

Genera el cliente y aplica migraciones y fixtures de desarrollo:

```sh
npm run db:generate
npm run db:migrate:dev
npm run db:seed
```

Inicia API y web de Base y de Transporte en terminales separadas:

```sh
npm run dev:base-api
npm run dev:base-web
npm run dev:api
npm run dev:web
```

La API de Base queda en `http://localhost:4000`; su web, en `http://localhost:5173`. Transporte usa `http://localhost:4100` para API y `http://localhost:5174` para web. El worker de correo de Base es opcional durante el desarrollo local:

```sh
npm run dev:base-email-worker
```

La configuración detallada de secretos, correo, archivos y administración inicial está en [mvp-base/README.md](mvp-base/README.md).

## Comandos de validación

Los comandos de raíz validan primero el código de Transporte y luego ejecutan los scripts existentes de mvp-base. `db:migrate:dev` aplica las migraciones de ambos productos contra sus respectivas bases.

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:integration
```

`test:integration` usa Docker y recursos desechables, según la guía de mvp-base. Para aplicar migraciones ya creadas en un entorno de desarrollo o prueba:

```sh
npm run db:migrate:deploy
```

No apuntes comandos locales a producción.

## Límites de datos

mvp-base es la fuente de verdad para usuarios, organizaciones, empresas, sucursales, personal, permisos, archivos y auditoría. Transporte conservará únicamente referencias a sus IDs y datos de sus dominios. No se importan fuentes privadas de mvp-base ni se consultan directamente sus tablas. Las migraciones de Transporte pertenecerán a su propia base de datos.

## Documentación del producto

- [Arquitectura](docs/architecture.md)
- [Contrato de integración con mvp-base](docs/integration/mvp-base.md)
- [Modelo de datos](docs/data-model.md)
- [Roadmap](docs/roadmap.md)
- [Tareas](docs/tasks/README.md)
