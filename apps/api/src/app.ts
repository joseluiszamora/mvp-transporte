import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { PrismaClient } from "./prisma/generated/client.ts";
import { createErrorHandler, ApiError } from "./errors.ts";
import type { BaseIntegrationClient } from "./modules/integrations/base-client.ts";
import { createDriverRouter } from "./modules/driver/driver-router.ts";
import { createOperationalStaffRouter } from "./modules/operational-staff/staff-router.ts";
import { createResourcesRouter } from "./modules/resources/resources-router.ts";
import { createTripsRouter } from "./modules/trips/trips-router.ts";
import { createVehiclesRouter } from "./modules/vehicles/vehicles-router.ts";

export interface ApplicationConfig {
  webOrigins: string[];
}

function getBearer(request: express.Request): string {
  const match = request.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  return match[1];
}

export function createApplication(database: PrismaClient, base: BaseIntegrationClient, config: ApplicationConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.setHeader("X-Request-Id", response.locals.requestId);
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.webOrigins.includes(origin)) callback(null, true);
      else callback(new ApiError(403, "ORIGIN_NOT_ALLOWED", "El origen no está permitido."));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    maxAge: 600,
  }));
  app.use(express.json({ limit: "64kb", strict: true }));

  const api = express.Router();
  api.get("/health", (_request, response) => response.status(200).json({ status: "ok" }));
  api.get("/ready", async (_request, response) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.status(200).json({ status: "ready" });
    } catch {
      response.status(503).json({ error: { code: "SERVICE_NOT_READY", message: "Servicio temporalmente no disponible.", requestId: response.locals.requestId } });
    }
  });
  api.get("/openapi.json", (_request, response) => response.status(200).json(openApiDocument));
  api.get("/companies", async (request, response, next) => {
    try {
      response.status(200).json({ items: await base.listCompanies(getBearer(request)) });
    } catch (error) {
      next(error);
    }
  });
  api.get("/branches", async (request, response, next) => {
    try {
      const companyId = request.query.companyId;
      if (typeof companyId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(companyId)) {
        throw new ApiError(400, "INVALID_REQUEST", "La empresa no es válida.");
      }
      response.status(200).json({ items: await base.listBranches(getBearer(request), companyId) });
    } catch (error) {
      next(error);
    }
  });
  api.use("/vehicles", createVehiclesRouter(database, base));
  api.use("/driver", createDriverRouter(database, base));
  api.use("/operational-staff", createOperationalStaffRouter(database, base));
  api.use("/trips", createTripsRouter(database, base));
  api.use("/", createResourcesRouter(database, base));
  app.use("/api/v1/transport", api);
  app.use("/api/v1/transport", (_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso no encontrado.", requestId: response.locals.requestId } }));

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "status" in error && error.status === 400 && !response.headersSent) {
      response.status(400).json({ error: { code: "INVALID_JSON", message: "El JSON de la solicitud no es válido.", requestId: response.locals.requestId } });
      return;
    }
    next(error);
  });
  app.use(createErrorHandler());
  return app;
}

const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "mvp-transporte API", version: "0.1.0" },
  servers: [{ url: "/api/v1/transport" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      ApiError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "requestId"] } } },
      Vehicle: { type: "object", properties: { id: { type: "string", format: "uuid" }, plate: { type: "string" }, capacityKg: { type: "number", exclusiveMinimum: 0 }, odometerKm: { type: ["integer", "null"], minimum: 0 }, status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } } },
      DriverTrip: { type: "object", additionalProperties: false, required: ["id", "type", "status", "vehiclePlate", "origin", "destination", "stops", "sealNumbers", "plannedStartAt", "plannedEndAt", "actualStartAt", "actualEndAt", "driverAssignments"], properties: { id: { type: "string", format: "uuid" }, type: { type: "string", enum: ["DISTRIBUTION", "SHORT_ROUTE", "LONG_DISTANCE"] }, status: { type: "string", enum: ["PLANNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] }, vehiclePlate: { type: "string" }, origin: { type: "string" }, destination: { type: "string" }, stops: { type: "array", items: { type: "string" } }, sealNumbers: { type: "array", items: { type: "string" } }, plannedStartAt: { type: "string", format: "date-time" }, plannedEndAt: { type: "string", format: "date-time" }, actualStartAt: { type: ["string", "null"], format: "date-time" }, actualEndAt: { type: ["string", "null"], format: "date-time" }, driverAssignments: { type: "array", items: { type: "object", additionalProperties: false, required: ["startsAt", "endsAt"], properties: { startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" } } } } } },
      PageOfDriverTrips: { type: "object", additionalProperties: false, required: ["items", "total", "limit", "offset"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/DriverTrip" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } },
      DriverTripResponse: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { $ref: "#/components/schemas/DriverTrip" } } },
    },
  },
  paths: {
    "/health": { get: { security: [], summary: "Comprobar disponibilidad", responses: { "200": { description: "API disponible" } } } },
    "/ready": { get: { security: [], summary: "Comprobar conexión de base de datos", responses: { "200": { description: "API lista" } } } },
    "/companies": { get: { summary: "Listar empresas visibles en mvp-base", responses: { "200": { description: "Empresas" } } } },
    "/branches": { get: { summary: "Listar sucursales visibles en mvp-base", responses: { "200": { description: "Sucursales" } } } },
    "/driver/trips": { get: { summary: "Listar solo viajes asignados al conductor autenticado", parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["PLANNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }], responses: { "200": { description: "Página de viajes propios", content: { "application/json": { schema: { $ref: "#/components/schemas/PageOfDriverTrips" } } } }, "401": { description: "Sesión no disponible" }, "403": { description: "Permiso o perfil de conductor requerido" } } } },
    "/driver/trips/{tripId}": { get: { summary: "Consultar un viaje asignado al conductor autenticado", parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Detalle del viaje propio", content: { "application/json": { schema: { $ref: "#/components/schemas/DriverTripResponse" } } } }, "404": { description: "El viaje no está disponible" } } } },
    "/driver/trips/{tripId}/status": { patch: { summary: "Iniciar o completar un viaje asignado al conductor autenticado", parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] } } } } } }, responses: { "200": { description: "Estado guardado con actor, evento y fecha", content: { "application/json": { schema: { $ref: "#/components/schemas/DriverTripResponse" } } } }, "403": { description: "Permiso requerido" }, "404": { description: "El viaje no está disponible" }, "409": { description: "La transición no es válida" } } } },
    "/vehicles": { get: { summary: "Buscar vehículos", responses: { "200": { description: "Página de vehículos" } } }, post: { summary: "Crear vehículo", responses: { "201": { description: "Vehículo creado" } } } },
    "/vehicles/{vehicleId}": { get: { summary: "Consultar vehículo", responses: { "200": { description: "Vehículo" } } }, patch: { summary: "Editar o desactivar vehículo", responses: { "200": { description: "Vehículo actualizado" } } } },
    "/operational-staff/employees": { get: { summary: "Listar personal de mvp-base", responses: { "200": { description: "Personal" } } } },
    "/operational-staff/driver-profiles": { get: { summary: "Listar perfiles de conductor", responses: { "200": { description: "Perfiles" } } }, post: { summary: "Crear perfil de conductor", responses: { "201": { description: "Perfil creado" } } } },
    "/operational-staff/assistant-profiles": { get: { summary: "Listar perfiles de ayudante", responses: { "200": { description: "Perfiles" } } }, post: { summary: "Crear perfil de ayudante", responses: { "201": { description: "Perfil creado" } } } },
    "/operational-staff/driver-profiles/{profileId}": { patch: { summary: "Cambiar estado del perfil de conductor", responses: { "200": { description: "Perfil actualizado" } } } },
    "/operational-staff/assistant-profiles/{profileId}": { patch: { summary: "Cambiar estado del perfil de ayudante", responses: { "200": { description: "Perfil actualizado" } } } },
    "/trips": { get: { summary: "Listar viajes y asignaciones por empresa", responses: { "200": { description: "Página de viajes" } } }, post: { summary: "Planificar un viaje", responses: { "201": { description: "Viaje planificado" } } } },
    "/trips/{tripId}": { get: { summary: "Consultar viaje e historial de cambios", responses: { "200": { description: "Viaje e historial" } } } },
    "/trips/{tripId}/assignment": { put: { summary: "Asignar o cambiar vehículo y tripulación conservando historial", responses: { "200": { description: "Asignación actualizada" } } } },
    "/trips/{tripId}/status": { patch: { summary: "Asignar, iniciar, completar o cancelar un viaje", responses: { "200": { description: "Estado actualizado" } } } },
    "/documents/{ownerType}/{ownerId}": { get: { summary: "Listar documentos privados de un vehículo o empleado", parameters: [{ name: "ownerType", in: "path", required: true, schema: { type: "string", enum: ["VEHICLE", "EMPLOYEE"] } }, { name: "ownerId", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "companyId", in: "query", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Documentos y referencias privadas" } } } },
    "/documents/{ownerType}/{ownerId}/upload": {
      post: {
        summary: "Subir o renovar un documento privado vía mvp-base",
        parameters: [
          { name: "ownerType", in: "path", required: true, schema: { type: "string", enum: ["VEHICLE", "EMPLOYEE"] } },
          { name: "ownerId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "companyId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "documentType", in: "query", required: true, schema: { type: "string", maxLength: 60 } },
          { name: "issuedAt", in: "query", schema: { type: "string", format: "date" } },
          { name: "expiresAt", in: "query", schema: { type: "string", format: "date" } },
          { name: "supersedesId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: { "201": { description: "Documento creado o renovado" } },
      },
    },
    "/documents/{documentId}/content": { get: { summary: "Descargar un archivo privado después de revalidar permisos", parameters: [{ name: "documentId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Contenido privado del archivo" } } } },
    "/maintenance/plans": { get: { summary: "Listar planes por empresa y opcionalmente vehículo", responses: { "200": { description: "Planes preventivos" } } }, post: { summary: "Crear plan preventivo por kilometraje, días o ambos", responses: { "201": { description: "Plan creado con próximo objetivo y ventana" } } } },
    "/maintenance/plans/{planId}": { patch: { summary: "Activar o desactivar un plan sin borrar su historial", parameters: [{ name: "planId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Estado del plan actualizado" } } } },
    "/maintenance/records": { get: { summary: "Listar historial de mantenimiento", responses: { "200": { description: "Registros de mantenimiento" } } }, post: { summary: "Registrar mantenimiento correctivo o preventivo", responses: { "201": { description: "Registro creado" } } } },
    "/maintenance/records/{recordId}": { patch: { summary: "Avanzar estado y disponibilidad de un mantenimiento", parameters: [{ name: "recordId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Registro actualizado" } } } },
    "/fuel/tanks": { get: { summary: "Listar tanques configurados", responses: { "200": { description: "Tanques por vehículo" } } }, post: { summary: "Configurar tanque de gasolina o GNV con unidad", responses: { "201": { description: "Tanque creado" } } } },
    "/fuel/tanks/{tankId}": { patch: { summary: "Activar o desactivar un tanque conservando cargas históricas", parameters: [{ name: "tankId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Estado del tanque actualizado" } } } },
    "/fuel/records": { get: { summary: "Listar cargas por empresa y vehículo", responses: { "200": { description: "Cargas con tipo de combustible y unidad" } } }, post: { summary: "Registrar una carga en un tanque activo del vehículo", responses: { "201": { description: "Carga registrada" } } } },
    "/fuel/summary": { get: { summary: "Resumir cantidad y costo agrupados por combustible, unidad y moneda", responses: { "200": { description: "Totales que mantienen separadas gasolina y GNV" } } } },
  },
};
