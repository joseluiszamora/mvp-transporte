# mvp-transporte

Producto de transporte que usa mvp-base para identidad, empresas, permisos, personal, archivos, auditoría, configuración y catálogos. El repositorio está en la fase de integración: todavía no contiene una API, web ni módulos de transporte propios.

## Estado actual

- `mvp-base/` es un submódulo fijado al commit registrado en [las decisiones del proyecto](docs/decisions.md).
- La integración de ejecución se realizará por HTTP entre APIs independientes. Cada producto conserva su base de datos y sus migraciones.
- Los contratos de autorización por alcance, auditoría de escritura y archivos vinculados a vehículos requieren una extensión pública de mvp-base. El estado y el detalle están en [docs/integration/mvp-base.md](docs/integration/mvp-base.md) y [TASK-007](docs/tasks/TASK-007-mvp-base-integration-contract.md).
- Los comandos de raíz delegan a mvp-base mientras Transporte todavía no tenga aplicaciones propias.

## Requisitos

- Node.js 24 y npm 11.
- Docker Engine o Docker Desktop con Docker Compose.
- Git con acceso al repositorio privado de mvp-base.

## Preparar el entorno local

Desde una clonación existente, inicializa el submódulo y sus dependencias:

```sh
git submodule update --init --recursive
npm run setup:base
```

Copia `mvp-base/.env.example` a `mvp-base/.env` y configura los valores locales. El archivo de ejemplo contiene valores ficticios. No compartas ni registres secretos.

Inicia PostgreSQL y Mailpit desde la raíz:

```sh
docker compose --env-file mvp-base/.env -f mvp-base/compose.yaml up -d
```

Genera el cliente y aplica migraciones y fixtures de desarrollo:

```sh
npm run db:generate
npm run db:migrate:dev
npm run db:seed
```

Inicia la API y la web en terminales separadas:

```sh
npm run dev:base-api
npm run dev:base-web
```

La API queda en `http://127.0.0.1:4000`; la web, en `http://127.0.0.1:5173`. El worker de correo es opcional durante la revisión inicial:

```sh
npm run dev:base-email-worker
```

La configuración detallada de secretos, correo, archivos y administración inicial está en [mvp-base/README.md](mvp-base/README.md).

## Comandos de validación

Estos comandos delegan a los scripts existentes de mvp-base. No incluyen código de transporte hasta que las aplicaciones de este repositorio se implementen.

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
