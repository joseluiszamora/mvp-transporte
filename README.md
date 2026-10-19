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
6. Para enviar correos locales, define `EMAIL_PAYLOAD_ENCRYPTION_KEY` y ejecuta el worker con `npm run dev:email-worker`.

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

## Correo local y worker

Mailpit recibe SMTP en `127.0.0.1:1025` y muestra el buzón en `http://127.0.0.1:8025`. El worker consulta el outbox de PostgreSQL; una caída SMTP no bloquea la transacción que creó el mensaje y los reintentos usan espera exponencial limitada.

Genera una clave local de 32 bytes para cifrar los datos de plantilla que esperan en el outbox:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Guárdala como `EMAIL_PAYLOAD_ENCRYPTION_KEY` en `.env` y no la compartas ni la registres. El worker requiere `DATABASE_URL`, la clave, `SMTP_HOST`, `SMTP_PORT` y `SMTP_FROM`; credenciales SMTP son opcionales y, si se configuran, se exige TLS salvo que se indique lo contrario. Las plantillas de activación, recuperación y cambio de contraseña se versionan en migraciones; la configuración administrativa de correo queda para tareas posteriores.

El transporte SMTP ofrece entrega al menos una vez: si el proceso cae después de que el servidor acepte el correo pero antes de guardar ese resultado en PostgreSQL, un reintento puede duplicarlo.

## Archivos privados

La API guarda bytes fuera de `apps/web/public` y nunca los sirve como archivos estáticos. `FILE_STORAGE_PATH` acepta una ruta absoluta o relativa a la raíz del repositorio; por defecto es `.data/files`. En desarrollo local, esa carpeta se excluye de Git. En una instalación persistente, monta un volumen privado en esa ruta y respáldalo junto con PostgreSQL.

ADM-08 permite adjuntar PDF, JPEG, PNG y WEBP de hasta 10 MiB a empresas y sucursales activas. La extensión, el MIME declarado y la firma del contenido deben coincidir. Para listar o descargar se necesitan `files.read`/`files.download` y el permiso de lectura de la empresa o sucursal; para cargar o quitar, `files.upload`/`files.delete` y el permiso de actualización correspondiente. ADM-05 también habilita fotos y documentos de empleados como recursos privados: se requieren permisos laborales, personales o documentales y de archivos según la operación. Los documentos usan tipos activos del catálogo correspondiente.

Quitar un adjunto lo oculta y marca para purga después de 24 horas. Programa `npm run files:cleanup` en el host que tenga montado el volumen. El comando purga solo registros sin enlaces que cumplieron el periodo de gracia y archivos físicos huérfanos o temporales con más de 24 horas; conserva archivos vinculados. Requiere `DATABASE_URL` y acceso de escritura al volumen configurado. No lo ejecutes contra datos persistentes sin validar primero el volumen y la conexión seleccionados.

## Acceso inicial y autenticación

Configura dos secretos distintos en `.env`: `ACCESS_TOKEN_SECRET` y `EMAIL_PAYLOAD_ENCRYPTION_KEY`. Para generar cada uno, ejecuta el siguiente comando por separado y guarda su salida solo en `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Verifica que `PUBLIC_WEB_URL` sea la URL de la web y que `WEB_ORIGINS` contenga su origen exacto. En desarrollo local se usa `http://127.0.0.1:5173`; producción requiere HTTPS para activar cookies `Secure`.

Después de aplicar migraciones y configurar correo, crea el primer administrador de plataforma con:

```sh
npm run bootstrap:platform-admin
```

El comando solicita correo, nombre y confirmación escrita. Crea una cuenta pendiente y encola un enlace de activación; no genera ni muestra una contraseña o el token. Inicia `npm run dev:email-worker` para que SMTP entregue el mensaje. En desarrollo, abre el enlace desde la bandeja de Mailpit en `http://127.0.0.1:8025`. El administrador define su contraseña al activar la cuenta; luego puede iniciar sesión en `http://127.0.0.1:5173/login` y crear una organización con su administración inicial.

El access token dura 15 minutos y solo vive en memoria del navegador. El refresh token se guarda en cookie HttpOnly y rota; la sesión global vence a los siete días y un nuevo login reemplaza la sesión anterior. La recuperación devuelve la misma respuesta aunque el correo no exista.

`npm run test:integration` inicia PostgreSQL desechable en `tmpfs` junto con Mailpit y usa puertos locales libres. Aplica todas las migraciones y fixtures; verifica restricciones de tenant/scope/sesión, auditoría y outbox, rotación/replay, login concurrente, selección multitenant, autorización, activación/invitaciones, recuperación, rate limit, archivos privados y entrega SMTP real al buzón temporal. La integración usa un volumen temporal para los archivos y lo elimina al finalizar, sin tocar la base local persistente.

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

La readiness no devuelve datos de conexión ni mensajes internos. TASK-004 agrega login, activación, recuperación, selector de organización, listado e invitaciones de membresía y alta inicial de organización. La administración de roles/scope y el resto de módulos se entrega en las tareas siguientes; los módulos sin implementar se muestran como pendientes.
