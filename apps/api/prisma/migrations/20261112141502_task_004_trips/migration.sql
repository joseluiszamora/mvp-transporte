-- CreateEnum
CREATE TYPE "trip_type" AS ENUM ('DISTRIBUTION', 'SHORT_ROUTE', 'LONG_DISTANCE');

-- CreateEnum
CREATE TYPE "trip_status" AS ENUM ('PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "trip_crew_role" AS ENUM ('DRIVER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "trip_crew_source" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "trip_event_type" AS ENUM ('CREATED', 'ASSIGNMENT_CHANGED', 'ASSIGNED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "trip_type" NOT NULL,
    "status" "trip_status" NOT NULL DEFAULT 'PLANNED',
    "vehicle_id" UUID NOT NULL,
    "contracting_company_id" UUID,
    "origin" VARCHAR(160) NOT NULL,
    "destination" VARCHAR(160) NOT NULL,
    "seal_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planned_start_at" TIMESTAMPTZ(6) NOT NULL,
    "planned_end_at" TIMESTAMPTZ(6) NOT NULL,
    "actual_start_at" TIMESTAMPTZ(6),
    "actual_end_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_actor_id" UUID,
    "cancellation_reason" VARCHAR(300),
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "location" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_crew_assignments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "role" "trip_crew_role" NOT NULL,
    "source" "trip_crew_source" NOT NULL,
    "employee_id" UUID,
    "external_name" VARCHAR(120),
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_actor_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_crew_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "type" "trip_event_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_scope_status_start_idx" ON "trips"("organization_id", "company_id", "status", "planned_start_at");

-- CreateIndex
CREATE INDEX "trips_vehicle_schedule_idx" ON "trips"("vehicle_id", "status", "planned_start_at", "planned_end_at");

-- CreateIndex
CREATE INDEX "trips_contracting_company_idx" ON "trips"("contracting_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_position_key" ON "trip_stops"("trip_id", "position");

-- CreateIndex
CREATE INDEX "trip_crew_trip_active_start_idx" ON "trip_crew_assignments"("trip_id", "is_active", "starts_at");

-- CreateIndex
CREATE INDEX "trip_crew_employee_schedule_idx" ON "trip_crew_assignments"("employee_id", "is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "trip_events_trip_created_idx" ON "trip_events"("trip_id", "created_at");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew_assignments" ADD CONSTRAINT "trip_crew_assignments_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_route_nonempty_check" CHECK (length(btrim("origin")) > 0 AND length(btrim("destination")) > 0),
  ADD CONSTRAINT "trips_period_check" CHECK ("planned_end_at" > "planned_start_at"),
  ADD CONSTRAINT "trips_long_details_check" CHECK (
    ("type" = 'LONG_DISTANCE' AND "contracting_company_id" IS NOT NULL AND cardinality("seal_numbers") > 0)
    OR ("type" <> 'LONG_DISTANCE' AND "contracting_company_id" IS NULL AND cardinality("seal_numbers") = 0)
  ),
  ADD CONSTRAINT "trips_cancellation_check" CHECK (
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_actor_id" IS NOT NULL AND length(btrim("cancellation_reason")) > 0)
    OR ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL AND "cancelled_by_actor_id" IS NULL AND "cancellation_reason" IS NULL)
  ),
  ADD CONSTRAINT "trips_completed_check" CHECK (
    ("status" = 'COMPLETED' AND "actual_start_at" IS NOT NULL AND "actual_end_at" IS NOT NULL AND "actual_end_at" >= "actual_start_at")
    OR ("status" <> 'COMPLETED' AND "actual_end_at" IS NULL)
  ),
  ADD CONSTRAINT "trips_started_check" CHECK ("status" NOT IN ('IN_PROGRESS', 'COMPLETED') OR "actual_start_at" IS NOT NULL);

ALTER TABLE "trip_stops"
  ADD CONSTRAINT "trip_stops_position_check" CHECK ("position" BETWEEN 1 AND 2),
  ADD CONSTRAINT "trip_stops_location_nonempty_check" CHECK (length(btrim("location")) > 0);

ALTER TABLE "trip_crew_assignments"
  ADD CONSTRAINT "trip_crew_period_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "trip_crew_person_source_check" CHECK (
    ("source" = 'INTERNAL' AND "employee_id" IS NOT NULL AND "external_name" IS NULL)
    OR ("role" = 'ASSISTANT' AND "source" = 'CLIENT' AND "employee_id" IS NULL)
  ),
  ADD CONSTRAINT "trip_crew_active_history_check" CHECK (
    ("is_active" = TRUE AND "cancelled_at" IS NULL AND "cancelled_by_actor_id" IS NULL)
    OR ("is_active" = FALSE AND "cancelled_at" IS NOT NULL AND "cancelled_by_actor_id" IS NOT NULL)
  );
