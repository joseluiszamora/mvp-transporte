import type {
  PageResponse,
  TripCrewAssignmentInput,
  TripCrewAssignmentItem,
  TripCreateInput,
  TripEventItem,
  TripItem,
  TripStatus,
  TripType,
} from "@mvp-transporte/shared-contracts";
import type { PrismaClient } from "../../prisma/generated/client.ts";
import type { Prisma } from "../../prisma/generated/client.ts";
import { ApiError } from "../../errors.ts";
import type { AuthorizedTarget, BaseIntegrationClient } from "../integrations/base-client.ts";
import { getAssignableVehicle, getVehiclePlates } from "../vehicles/vehicle-service.ts";
import { assertActiveOperationalEmployee } from "../operational-staff/staff-service.ts";
import { assertTripResourcesAvailable } from "../resources/resource-service.ts";

export type TripCommand = Omit<TripCreateInput, "plannedStartAt" | "plannedEndAt" | "crew" | "stops" | "sealNumbers"> & {
  plannedStartAt: Date;
  plannedEndAt: Date;
  sealNumbers: string[];
  stops: string[];
  crew: Array<Omit<TripCrewAssignmentInput, "startsAt" | "endsAt"> & { startsAt: Date; endsAt: Date }>;
};
type CrewEntry = { role: string; source: string; employeeId: string | null; startsAt: Date; endsAt: Date; isActive: boolean };

const tripInclude = {
  stops: { orderBy: { position: "asc" as const } },
  crew: { orderBy: [{ startsAt: "asc" as const }, { createdAt: "asc" as const }] },
  events: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.TripInclude;

type TripWithDetails = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

function scopeWhere(target: AuthorizedTarget) {
  return {
    organizationId: target.organizationId,
    companyId: target.companyId,
    ...(target.branchId ? { branchId: target.branchId } : {}),
  };
}

function mapCrew(row: TripWithDetails["crew"][number]): TripCrewAssignmentItem {
  return {
    id: row.id,
    role: row.role,
    source: row.source,
    ...(row.employeeId ? { employeeId: row.employeeId } : {}),
    ...(row.externalName ? { externalName: row.externalName } : {}),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    isActive: row.isActive,
    createdByActorId: row.createdByActorId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapEvent(row: TripWithDetails["events"][number]): TripEventItem {
  const payload = row.payload;
  return {
    id: row.id,
    type: row.type,
    actorId: row.actorId,
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapTrip(row: TripWithDetails, vehiclePlate: string): TripItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyId: row.companyId,
    branchId: row.branchId,
    type: row.type,
    status: row.status,
    vehicleId: row.vehicleId,
    vehiclePlate,
    contractingCompanyId: row.contractingCompanyId,
    origin: row.origin,
    destination: row.destination,
    sealNumbers: row.sealNumbers,
    plannedStartAt: row.plannedStartAt.toISOString(),
    plannedEndAt: row.plannedEndAt.toISOString(),
    actualStartAt: row.actualStartAt?.toISOString() ?? null,
    actualEndAt: row.actualEndAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    stops: row.stops.map((stop) => ({ id: stop.id, position: stop.position, location: stop.location })),
    crew: row.crew.map(mapCrew),
    events: row.events.map(mapEvent),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireVehiclePlate(vehiclePlates: Map<string, string>, vehicleId: string): string {
  const plate = vehiclePlates.get(vehicleId);
  if (!plate) throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible para esta empresa.");
  return plate;
}

function normalizedCommand(input: TripCommand): TripCommand {
  const clean = (value: string) => value.trim();
  const sealNumbers = [...new Set((input.sealNumbers ?? []).map(clean).filter(Boolean))];
  return {
    ...input,
    origin: clean(input.origin),
    destination: clean(input.destination),
    contractingCompanyId: input.contractingCompanyId?.trim() || null,
    sealNumbers,
    stops: input.stops.map(clean),
    crew: input.crew.map((person) => ({
      ...person,
      ...(person.externalName !== undefined ? { externalName: clean(person.externalName) } : {}),
    })),
  };
}

function assistantCount(crew: Array<{ role: string; source: string; employeeId?: string | null; isActive?: boolean }>): number {
  let clientCount = 0;
  const internalEmployees = new Set<string>();
  for (const person of crew) {
    if (person.role !== "ASSISTANT" || person.isActive === false) continue;
    if (person.source === "CLIENT") clientCount += 1;
    else if (person.employeeId) internalEmployees.add(person.employeeId);
  }
  return clientCount + internalEmployees.size;
}

function validateTripShape(input: TripCommand): void {
  if (input.plannedStartAt.getTime() >= input.plannedEndAt.getTime()) {
    throw new ApiError(400, "INVALID_TRIP_PERIOD", "La fecha prevista de fin debe ser posterior al inicio.");
  }
  if (!input.origin || !input.destination) throw new ApiError(400, "INVALID_TRIP_ROUTE", "Indica el origen y el destino.");
  if (input.crew.length > 30) throw new ApiError(400, "INVALID_TRIP_CREW", "La tripulación supera el límite permitido.");
  if (input.stops.some((location) => !location)) throw new ApiError(400, "INVALID_TRIP_STOPS", "Las paradas no pueden estar vacías.");

  if (input.type === "SHORT_ROUTE" && (input.stops.length < 1 || input.stops.length > 2)) {
    throw new ApiError(400, "INVALID_SHORT_ROUTE_STOPS", "Una ruta corta debe tener una o dos paradas.");
  }
  if (input.type !== "SHORT_ROUTE" && input.stops.length > 0) {
    throw new ApiError(400, "TRIP_STOPS_NOT_ALLOWED", "Solo una ruta corta puede registrar paradas en esta etapa.");
  }
  if (input.type === "LONG_DISTANCE") {
    if (!input.contractingCompanyId || input.sealNumbers.length === 0) {
      throw new ApiError(400, "LONG_TRIP_DETAILS_REQUIRED", "El viaje largo requiere empresa contratante y al menos un precinto.");
    }
  } else if (input.contractingCompanyId || input.sealNumbers.length > 0) {
    throw new ApiError(400, "LONG_TRIP_DETAILS_NOT_ALLOWED", "La empresa contratante y los precintos solo corresponden a viajes largos.");
  }

  for (const person of input.crew) {
    if (person.startsAt.getTime() >= person.endsAt.getTime() ||
      person.startsAt.getTime() < input.plannedStartAt.getTime() || person.endsAt.getTime() > input.plannedEndAt.getTime()) {
      throw new ApiError(400, "INVALID_CREW_PERIOD", "Cada periodo de tripulación debe estar dentro del viaje y tener duración positiva.");
    }
    if (person.role === "DRIVER" && (person.source !== "INTERNAL" || !person.employeeId || person.externalName)) {
      throw new ApiError(400, "INVALID_TRIP_DRIVER", "Cada conductor debe ser un empleado interno con perfil de conductor.");
    }
    if (person.role === "ASSISTANT" && person.source === "INTERNAL" && (!person.employeeId || person.externalName)) {
      throw new ApiError(400, "INVALID_INTERNAL_ASSISTANT", "El ayudante interno debe ser un empleado con perfil activo.");
    }
    if (person.role === "ASSISTANT" && person.source === "CLIENT" && person.employeeId) {
      throw new ApiError(400, "INVALID_CLIENT_ASSISTANT", "El ayudante del cliente no puede referenciar un empleado interno.");
    }
  }

  const assistants = assistantCount(input.crew);
  if (input.type === "DISTRIBUTION" && (assistants < 1 || assistants > 2)) {
    throw new ApiError(400, "DISTRIBUTION_ASSISTANT_COUNT", "Una distribución requiere uno o dos ayudantes en total.");
  }
  if (input.type === "SHORT_ROUTE" && assistants > 0) {
    throw new ApiError(400, "SHORT_ROUTE_ASSISTANT_NOT_ALLOWED", "La ruta corta no admite ayudantes en esta etapa.");
  }

  const internal = input.crew.filter((person) => person.source === "INTERNAL" && person.employeeId);
  for (let index = 0; index < internal.length; index += 1) {
    const current = internal[index];
    if (!current?.employeeId) continue;
    for (const other of internal.slice(index + 1)) {
      if (other.employeeId === current.employeeId && current.startsAt < other.endsAt && current.endsAt > other.startsAt) {
        throw new ApiError(400, "TRIP_CREW_OVERLAP", "Una persona no puede cubrir dos funciones en periodos superpuestos.");
      }
    }
  }
}

async function validateContractingCompany(base: BaseIntegrationClient, bearer: string, input: TripCommand): Promise<void> {
  if (!input.contractingCompanyId) return;
  const companies = await base.listCompanies(bearer);
  const company = companies.find((item) => item.id === input.contractingCompanyId);
  if (company?.status !== "ACTIVE") {
    throw new ApiError(409, "CONTRACTING_COMPANY_UNAVAILABLE", "La empresa contratante no está activa o no está disponible en mvp-base.");
  }
}

async function validateInternalCrew(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  crew: TripCommand["crew"],
): Promise<void> {
  const uniqueEmployees = [...new Set(crew.flatMap((person) => person.source === "INTERNAL" && person.employeeId ? [person.employeeId] : []))];
  for (const employeeId of uniqueEmployees) {
    const roles = new Set(crew.filter((person) => person.employeeId === employeeId).map((person) => person.role));
    for (const role of roles) {
      if (role !== "DRIVER" && role !== "ASSISTANT") continue;
      await assertActiveOperationalEmployee(database, base, bearer, target, role === "DRIVER" ? "driver" : "assistant", employeeId);
    }
  }
}

function internalEmployeeIds(crew: Array<{ source: string; employeeId?: string | null; isActive?: boolean }>): string[] {
  return [...new Set(crew.flatMap((person) => person.isActive === false || person.source !== "INTERNAL" || !person.employeeId ? [] : [person.employeeId]))];
}

async function lockResources(
  transaction: Prisma.TransactionClient,
  vehicleIds: string[],
  employeeIds: string[],
): Promise<void> {
  const keys = [...new Set([
    ...vehicleIds.map((id) => `transport:vehicle:${id}`),
    ...employeeIds.map((id) => `transport:employee:${id}`),
  ])].sort();
  for (const key of keys) await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function assertDriverCoverage(type: TripType, start: Date, end: Date, crew: Array<{ role: string; source: string; employeeId: string | null; startsAt: Date; endsAt: Date; isActive?: boolean }>): void {
  const drivers = crew.filter((person) => person.role === "DRIVER" && person.source === "INTERNAL" && person.employeeId && person.isActive !== false)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (drivers.length === 0) throw new ApiError(409, "TRIP_DRIVER_REQUIRED", "Asigna conductores para cubrir el periodo completo del viaje.");
  if (type !== "LONG_DISTANCE" && drivers.length !== 1) {
    throw new ApiError(409, "TRIP_DRIVER_COUNT", "La distribución y la ruta corta requieren un solo conductor para todo el periodo.");
  }
  if (drivers[0]?.startsAt.getTime() !== start.getTime() || drivers.at(-1)?.endsAt.getTime() !== end.getTime()) {
    throw new ApiError(409, "TRIP_DRIVER_COVERAGE", "Los intervalos de conducción deben cubrir desde el inicio hasta el fin del viaje.");
  }
  for (let index = 1; index < drivers.length; index += 1) {
    const previous = drivers[index - 1];
    const current = drivers[index];
    if (!previous || !current || previous.endsAt.getTime() !== current.startsAt.getTime()) {
      throw new ApiError(409, "TRIP_DRIVER_COVERAGE", "Los relevos deben ser sucesivos, sin huecos ni superposiciones.");
    }
  }
}

async function assertNoOverlaps(
  transaction: Prisma.TransactionClient,
  tripId: string,
  vehicleId: string,
  start: Date,
  end: Date,
  crew: CrewEntry[],
): Promise<void> {
  const vehicleConflict = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM trips
    WHERE vehicle_id = ${vehicleId}::uuid AND id <> ${tripId}::uuid
      AND status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
      AND (
        (status = 'IN_PROGRESS' AND actual_end_at IS NULL)
        OR (COALESCE(actual_start_at, planned_start_at) < ${end}
          AND COALESCE(actual_end_at, planned_end_at) > ${start})
      )
    LIMIT 1`;
  if (vehicleConflict.length > 0) throw new ApiError(409, "TRIP_VEHICLE_OVERLAP", "El vehículo ya está asignado a otro viaje en ese periodo.");

  const assignments = crew.filter((person) => person.isActive && person.source === "INTERNAL" && person.employeeId);
  for (const person of assignments) {
    const employeeId = person.employeeId;
    if (!employeeId) continue;
    const conflict = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT assignment.id
      FROM trip_crew_assignments AS assignment
      JOIN trips AS trip ON trip.id = assignment.trip_id
      WHERE assignment.employee_id = ${employeeId}::uuid
        AND assignment.source = 'INTERNAL' AND assignment.is_active = TRUE
        AND trip.id <> ${tripId}::uuid
        AND trip.status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
        AND assignment.starts_at < ${person.endsAt}
        AND assignment.ends_at > ${person.startsAt}
      LIMIT 1`;
    if (conflict.length > 0) throw new ApiError(409, "TRIP_EMPLOYEE_OVERLAP", "Una persona de la tripulación ya participa en otro viaje en ese periodo.");
  }
}

async function createCrewRows(
  transaction: Prisma.TransactionClient,
  tripId: string,
  actorId: string,
  crew: TripCommand["crew"],
): Promise<void> {
  if (crew.length === 0) return;
  await transaction.tripCrewAssignment.createMany({ data: crew.map((person) => ({
    tripId,
    role: person.role,
    source: person.source,
    employeeId: person.employeeId ?? null,
    externalName: person.source === "CLIENT" ? person.externalName || null : null,
    startsAt: person.startsAt,
    endsAt: person.endsAt,
    createdByActorId: actorId,
  })) });
}

function jsonPayload(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function addEvent(
  transaction: Prisma.TransactionClient,
  tripId: string,
  type: "CREATED" | "ASSIGNMENT_CHANGED" | "ASSIGNED" | "STARTED" | "COMPLETED" | "CANCELLED",
  actorId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await transaction.tripEvent.create({ data: { tripId, type, actorId, payload: jsonPayload(payload) } });
}

function crewSnapshot(crew: TripCommand["crew"] | TripWithDetails["crew"]): Array<Record<string, unknown>> {
  return crew.map((person) => ({
    role: person.role,
    source: person.source,
    employeeId: person.employeeId,
    externalName: "externalName" in person ? person.externalName ?? null : null,
    startsAt: person.startsAt.toISOString(),
    endsAt: person.endsAt.toISOString(),
  }));
}

export async function listTrips(
  database: PrismaClient,
  target: AuthorizedTarget,
  input: { limit: number; offset: number; status?: TripStatus; type?: TripType; from?: Date; to?: Date },
): Promise<PageResponse<TripItem>> {
  const where = {
    ...scopeWhere(target),
    ...(input.status ? { status: input.status } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.from || input.to ? { plannedStartAt: {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lte: input.to } : {}),
    } } : {}),
  };
  const [items, total] = await Promise.all([
    database.trip.findMany({ where, include: tripInclude, orderBy: [{ plannedStartAt: "desc" }, { id: "desc" }], take: input.limit, skip: input.offset }),
    database.trip.count({ where }),
  ]);
  const vehiclePlates = await getVehiclePlates(database, target, items.map((trip) => trip.vehicleId));
  return { items: items.map((trip) => mapTrip(trip, requireVehiclePlate(vehiclePlates, trip.vehicleId))), total, limit: input.limit, offset: input.offset };
}

export async function getTrip(database: PrismaClient, target: AuthorizedTarget, id: string): Promise<TripItem> {
  const trip = await database.trip.findFirst({ where: { id, ...scopeWhere(target) }, include: tripInclude });
  if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
  const vehiclePlates = await getVehiclePlates(database, target, [trip.vehicleId]);
  return mapTrip(trip, requireVehiclePlate(vehiclePlates, trip.vehicleId));
}

async function loadTripForWrite(database: PrismaClient, id: string) {
  const trip = await database.trip.findUnique({ where: { id }, include: tripInclude });
  if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
  return trip;
}

async function validateAssignmentInputs(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  trip: { type: TripType; contractingCompanyId: string | null; plannedStartAt: Date; plannedEndAt: Date },
  crew: TripCommand["crew"],
): Promise<void> {
  const input: TripCommand = {
    companyId: target.companyId,
    branchId: target.branchId,
    type: trip.type,
    vehicleId: "00000000-0000-4000-8000-000000000000",
    contractingCompanyId: trip.contractingCompanyId,
    origin: "origin",
    destination: "destination",
    sealNumbers: trip.type === "LONG_DISTANCE" ? ["present"] : [],
    plannedStartAt: trip.plannedStartAt,
    plannedEndAt: trip.plannedEndAt,
    stops: trip.type === "SHORT_ROUTE" ? ["stop"] : [],
    crew,
  };
  validateTripShape(input);
  await validateContractingCompany(base, bearer, input);
  await validateInternalCrew(database, base, bearer, target, crew);
}

async function assertAssignable(
  transaction: Prisma.TransactionClient,
  target: AuthorizedTarget,
  trip: { id: string; type: TripType; vehicleId: string; plannedStartAt: Date; plannedEndAt: Date },
  crew: CrewEntry[],
): Promise<void> {
  assertDriverCoverage(trip.type, trip.plannedStartAt, trip.plannedEndAt, crew);
  const assistants = assistantCount(crew);
  if (trip.type === "DISTRIBUTION" && (assistants < 1 || assistants > 2)) {
    throw new ApiError(409, "DISTRIBUTION_ASSISTANT_COUNT", "Una distribución requiere uno o dos ayudantes activos.");
  }
  if (trip.type === "SHORT_ROUTE" && assistants > 0) throw new ApiError(409, "SHORT_ROUTE_ASSISTANT_NOT_ALLOWED", "La ruta corta no admite ayudantes en esta etapa.");
  await getAssignableVehicle(transaction, target, trip.vehicleId);
  const employeeIds = internalEmployeeIds(crew);
  await assertTripResourcesAvailable(transaction, target, trip, employeeIds);
  await assertNoOverlaps(transaction, trip.id, trip.vehicleId, trip.plannedStartAt, trip.plannedEndAt, crew);
}

export async function createTrip(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  rawInput: TripCommand,
): Promise<TripItem> {
  const input = normalizedCommand(rawInput);
  validateTripShape(input);
  await validateContractingCompany(base, bearer, input);
  await validateInternalCrew(database, base, bearer, target, input.crew);
  await getAssignableVehicle(database, target, input.vehicleId);

  const trip = await database.$transaction(async (transaction) => {
    const row = await transaction.trip.create({ data: {
      organizationId: target.organizationId,
      companyId: target.companyId,
      branchId: target.branchId,
      type: input.type,
      vehicleId: input.vehicleId,
      contractingCompanyId: input.contractingCompanyId ?? null,
      origin: input.origin,
      destination: input.destination,
      sealNumbers: input.sealNumbers,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      createdByActorId: target.actorId,
      stops: { create: input.stops.map((location, index) => ({ position: index + 1, location })) },
    } });
    await createCrewRows(transaction, row.id, target.actorId, input.crew);
    await addEvent(transaction, row.id, "CREATED", target.actorId, {
      type: row.type, vehicleId: row.vehicleId, plannedStartAt: row.plannedStartAt.toISOString(), plannedEndAt: row.plannedEndAt.toISOString(),
    });
    await base.audit(bearer, target, {
      action: "TRIP_CREATED", resourceType: "transport.trip", resourceId: row.id,
      after: { type: row.type, status: row.status, vehicleId: row.vehicleId, plannedStartAt: row.plannedStartAt.toISOString(), plannedEndAt: row.plannedEndAt.toISOString() },
    });
    return transaction.trip.findUniqueOrThrow({ where: { id: row.id }, include: tripInclude });
  });
  const vehiclePlates = await getVehiclePlates(database, target, [trip.vehicleId]);
  return mapTrip(trip, requireVehiclePlate(vehiclePlates, trip.vehicleId));
}

export async function updateTripAssignment(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  tripId: string,
  input: { vehicleId: string; crew: TripCommand["crew"] },
): Promise<TripItem> {
  const initial = await loadTripForWrite(database, tripId);
  if (initial.organizationId !== target.organizationId || initial.companyId !== target.companyId || (target.branchId && initial.branchId !== target.branchId)) {
    throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
  }
  if (initial.status !== "PLANNED" && initial.status !== "ASSIGNED") throw new ApiError(409, "TRIP_ASSIGNMENT_LOCKED", "Solo se puede cambiar la asignación antes de iniciar el viaje.");
  const crew = input.crew.map((person) => ({ ...person, startsAt: person.startsAt, endsAt: person.endsAt }));
  await validateAssignmentInputs(database, base, bearer, target, initial, crew);
  await getAssignableVehicle(database, target, input.vehicleId);

  const result = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
    const current = await transaction.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    if (current.status !== "PLANNED" && current.status !== "ASSIGNED") throw new ApiError(409, "TRIP_ASSIGNMENT_LOCKED", "Solo se puede cambiar la asignación antes de iniciar el viaje.");
    const activeCrew = current.crew.filter((person) => person.isActive);
    await lockResources(transaction, [current.vehicleId, input.vehicleId], [...internalEmployeeIds(activeCrew), ...internalEmployeeIds(crew)]);
    if (current.status === "ASSIGNED") {
      const assignedCrew = crew.map((person) => ({ ...person, isActive: true, employeeId: person.employeeId ?? null }));
      await assertAssignable(transaction, target, { ...current, vehicleId: input.vehicleId }, assignedCrew);
    }
    const now = new Date();
    await transaction.tripCrewAssignment.updateMany({ where: { tripId, isActive: true }, data: {
      isActive: false, cancelledAt: now, cancelledByActorId: target.actorId,
    } });
    await createCrewRows(transaction, tripId, target.actorId, crew);
    const updated = await transaction.trip.update({ where: { id: tripId }, data: { vehicleId: input.vehicleId } });
    await addEvent(transaction, tripId, "ASSIGNMENT_CHANGED", target.actorId, {
      previousVehicleId: current.vehicleId, vehicleId: updated.vehicleId,
      previousCrew: crewSnapshot(activeCrew), crew: crewSnapshot(crew),
    });
    await base.audit(bearer, target, {
      action: "TRIP_ASSIGNMENT_CHANGED", resourceType: "transport.trip", resourceId: tripId,
      before: { vehicleId: current.vehicleId, crew: crewSnapshot(activeCrew) },
      after: { vehicleId: updated.vehicleId, crew: crewSnapshot(crew) },
    });
    return transaction.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
  });
  const vehiclePlates = await getVehiclePlates(database, target, [result.vehicleId]);
  return mapTrip(result, requireVehiclePlate(vehiclePlates, result.vehicleId));
}

export async function transitionTrip(
  database: PrismaClient,
  base: BaseIntegrationClient,
  bearer: string,
  target: AuthorizedTarget,
  tripId: string,
  input: { status: Exclude<TripStatus, "PLANNED">; cancellationReason?: string },
): Promise<TripItem> {
  const initial = await loadTripForWrite(database, tripId);
  if (initial.organizationId !== target.organizationId || initial.companyId !== target.companyId || (target.branchId && initial.branchId !== target.branchId)) {
    throw new ApiError(404, "TRIP_NOT_FOUND", "El viaje no está disponible.");
  }
  const allowed: Record<TripStatus, TripStatus[]> = {
    PLANNED: ["ASSIGNED", "CANCELLED"], ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
  };
  if (!allowed[initial.status].includes(input.status)) throw new ApiError(409, "INVALID_TRIP_TRANSITION", "El viaje no admite ese cambio de estado.");
  if (input.status === "CANCELLED" && !input.cancellationReason?.trim()) throw new ApiError(400, "CANCELLATION_REASON_REQUIRED", "Indica el motivo de cancelación.");
  if (input.status === "ASSIGNED" || input.status === "IN_PROGRESS") {
    const commandCrew = initial.crew.filter((person) => person.isActive).map((person) => ({
      role: person.role,
      source: person.source,
      ...(person.employeeId ? { employeeId: person.employeeId } : {}),
      ...(person.externalName ? { externalName: person.externalName } : {}),
      startsAt: person.startsAt,
      endsAt: person.endsAt,
    }));
    await validateAssignmentInputs(database, base, bearer, target, initial, commandCrew);
    await getAssignableVehicle(database, target, initial.vehicleId);
  }

  const result = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
    const current = await transaction.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    if (!allowed[current.status].includes(input.status)) throw new ApiError(409, "INVALID_TRIP_TRANSITION", "El viaje cambió y ya no admite ese estado.");
    const activeCrew = current.crew.filter((person) => person.isActive);
    await lockResources(transaction, [current.vehicleId], internalEmployeeIds(activeCrew));
    if (input.status === "ASSIGNED" || input.status === "IN_PROGRESS") {
      await assertAssignable(transaction, target, current, activeCrew);
    }
    const now = new Date();
    const data = input.status === "IN_PROGRESS"
      ? { status: input.status, actualStartAt: now }
      : input.status === "COMPLETED"
        ? { status: input.status, actualEndAt: now }
        : input.status === "CANCELLED"
          ? { status: input.status, cancelledAt: now, cancelledByActorId: target.actorId, cancellationReason: input.cancellationReason?.trim() ?? null }
          : { status: input.status };
    const updated = await transaction.trip.update({ where: { id: tripId }, data });
    if (input.status === "CANCELLED") await transaction.tripCrewAssignment.updateMany({ where: { tripId, isActive: true }, data: {
      isActive: false, cancelledAt: now, cancelledByActorId: target.actorId,
    } });
    await addEvent(transaction, tripId, input.status === "IN_PROGRESS" ? "STARTED" : input.status, target.actorId, {
      previousStatus: current.status, status: updated.status,
      ...(input.cancellationReason ? { cancellationReason: input.cancellationReason.trim() } : {}),
      ...(input.status === "IN_PROGRESS" ? { actualStartAt: now.toISOString() } : {}),
      ...(input.status === "COMPLETED" ? { actualEndAt: now.toISOString() } : {}),
    });
    await base.audit(bearer, target, {
      action: `TRIP_${input.status}`, resourceType: "transport.trip", resourceId: tripId,
      before: { status: current.status }, after: { status: updated.status },
    });
    return transaction.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
  });
  const vehiclePlates = await getVehiclePlates(database, target, [result.vehicleId]);
  return mapTrip(result, requireVehiclePlate(vehiclePlates, result.vehicleId));
}
