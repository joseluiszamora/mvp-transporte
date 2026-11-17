-- CreateEnum
CREATE TYPE "document_owner_type" AS ENUM ('VEHICLE', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('CURRENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "maintenance_type" AS ENUM ('PREVENTIVE', 'CORRECTIVE');

-- CreateEnum
CREATE TYPE "maintenance_record_status" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fuel_type" AS ENUM ('GASOLINE', 'GNV');

-- CreateEnum
CREATE TYPE "fuel_unit" AS ENUM ('LITER', 'CUBIC_METER', 'KILOGRAM');

-- CreateTable
CREATE TABLE "resource_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "owner_type" "document_owner_type" NOT NULL,
    "vehicle_id" UUID,
    "employee_id" UUID,
    "document_type" VARCHAR(60) NOT NULL,
    "file_id" UUID NOT NULL,
    "issued_at" DATE,
    "expires_at" DATE,
    "status" "document_status" NOT NULL DEFAULT 'CURRENT',
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "interval_km" INTEGER,
    "interval_days" INTEGER,
    "window_days" INTEGER NOT NULL DEFAULT 15,
    "next_due_km" INTEGER,
    "next_due_at" DATE,
    "window_start_at" DATE,
    "window_end_at" DATE,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "plan_id" UUID,
    "type" "maintenance_type" NOT NULL,
    "status" "maintenance_record_status" NOT NULL DEFAULT 'SCHEDULED',
    "description" VARCHAR(500) NOT NULL,
    "provider" VARCHAR(120),
    "scheduled_at" DATE,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "out_of_service" BOOLEAN NOT NULL DEFAULT false,
    "odometer_km" INTEGER,
    "cost_amount" DECIMAL(12,2),
    "currency_code" CHAR(3) NOT NULL DEFAULT 'BOB',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_fuel_tanks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "fuel_type" "fuel_type" NOT NULL,
    "unit" "fuel_unit" NOT NULL,
    "capacity" DECIMAL(12,3) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_fuel_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "tank_id" UUID NOT NULL,
    "fuel_type" "fuel_type" NOT NULL,
    "unit" "fuel_unit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "cost_amount" DECIMAL(12,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'BOB',
    "odometer_km" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resource_documents_file_id_key" ON "resource_documents"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_documents_supersedes_id_key" ON "resource_documents"("supersedes_id");

-- CreateIndex
CREATE INDEX "resource_documents_scope_owner_status_idx" ON "resource_documents"("organization_id", "company_id", "owner_type", "vehicle_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "resource_documents_scope_expiry_idx" ON "resource_documents"("organization_id", "company_id", "expires_at");

-- CreateIndex
CREATE INDEX "maintenance_plans_scope_vehicle_status_idx" ON "maintenance_plans"("organization_id", "company_id", "vehicle_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_plans_scope_due_date_idx" ON "maintenance_plans"("organization_id", "company_id", "next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_vehicle_name_key" ON "maintenance_plans"("vehicle_id", "name");

-- CreateIndex
CREATE INDEX "maintenance_records_scope_vehicle_status_idx" ON "maintenance_records"("organization_id", "company_id", "vehicle_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_records_scope_schedule_idx" ON "maintenance_records"("organization_id", "company_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "vehicle_fuel_tanks_scope_vehicle_status_idx" ON "vehicle_fuel_tanks"("organization_id", "company_id", "vehicle_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_fuel_tanks_vehicle_name_key" ON "vehicle_fuel_tanks"("vehicle_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_fuel_tanks_id_vehicle_key" ON "vehicle_fuel_tanks"("id", "vehicle_id");

-- CreateIndex
CREATE INDEX "fuel_records_scope_vehicle_date_idx" ON "fuel_records"("organization_id", "company_id", "vehicle_id", "occurred_at");

-- CreateIndex
CREATE INDEX "fuel_records_scope_fuel_unit_idx" ON "fuel_records"("organization_id", "company_id", "fuel_type", "unit");

-- AddForeignKey
ALTER TABLE "resource_documents" ADD CONSTRAINT "resource_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_documents" ADD CONSTRAINT "resource_documents_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "resource_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_tanks" ADD CONSTRAINT "vehicle_fuel_tanks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_records" ADD CONSTRAINT "fuel_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_records" ADD CONSTRAINT "fuel_records_tank_id_vehicle_id_fkey" FOREIGN KEY ("tank_id", "vehicle_id") REFERENCES "vehicle_fuel_tanks"("id", "vehicle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resource_documents"
  ADD CONSTRAINT "resource_documents_owner_check" CHECK (
    ("owner_type" = 'VEHICLE' AND "vehicle_id" IS NOT NULL AND "employee_id" IS NULL)
    OR ("owner_type" = 'EMPLOYEE' AND "vehicle_id" IS NULL AND "employee_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "resource_documents_type_nonempty_check" CHECK (length(btrim("document_type")) > 0),
  ADD CONSTRAINT "resource_documents_expiry_check" CHECK ("issued_at" IS NULL OR "expires_at" IS NULL OR "expires_at" >= "issued_at");

ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT "maintenance_plans_name_nonempty_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "maintenance_plans_interval_check" CHECK (
    ("interval_km" IS NOT NULL AND "interval_km" > 0 OR "interval_days" IS NOT NULL AND "interval_days" > 0)
    AND ("interval_km" IS NULL OR "interval_km" > 0)
    AND ("interval_days" IS NULL OR "interval_days" > 0)
  ),
  ADD CONSTRAINT "maintenance_plans_window_check" CHECK (
    "window_days" BETWEEN 0 AND 365
    AND (("window_start_at" IS NULL AND "window_end_at" IS NULL)
      OR ("next_due_at" IS NOT NULL AND "window_start_at" IS NOT NULL AND "window_end_at" IS NOT NULL
        AND "window_start_at" <= "next_due_at" AND "next_due_at" <= "window_end_at"))
  ),
  ADD CONSTRAINT "maintenance_plans_due_km_check" CHECK ("next_due_km" IS NULL OR "next_due_km" >= 0);

ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_description_nonempty_check" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "maintenance_records_odometer_check" CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0),
  ADD CONSTRAINT "maintenance_records_cost_check" CHECK ("cost_amount" IS NULL OR "cost_amount" >= 0),
  ADD CONSTRAINT "maintenance_records_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
  ),
  ADD CONSTRAINT "maintenance_records_out_of_service_check" CHECK (NOT "out_of_service" OR "status" = 'IN_PROGRESS'),
  ADD CONSTRAINT "maintenance_records_dates_check" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "vehicle_fuel_tanks"
  ADD CONSTRAINT "vehicle_fuel_tanks_name_nonempty_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "vehicle_fuel_tanks_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "vehicle_fuel_tanks_fuel_unit_check" CHECK (
    ("fuel_type" = 'GASOLINE' AND "unit" = 'LITER')
    OR ("fuel_type" = 'GNV' AND "unit" IN ('CUBIC_METER', 'KILOGRAM'))
  );

ALTER TABLE "fuel_records"
  ADD CONSTRAINT "fuel_records_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "fuel_records_cost_check" CHECK ("cost_amount" >= 0),
  ADD CONSTRAINT "fuel_records_odometer_check" CHECK ("odometer_km" >= 0);

CREATE FUNCTION validate_fuel_record_tank() RETURNS trigger AS $$
DECLARE
  tank_fuel_type "fuel_type";
  tank_unit "fuel_unit";
  tank_organization_id UUID;
  tank_company_id UUID;
  tank_branch_id UUID;
BEGIN
  SELECT fuel_type, unit, organization_id, company_id, branch_id
    INTO tank_fuel_type, tank_unit, tank_organization_id, tank_company_id, tank_branch_id
    FROM vehicle_fuel_tanks WHERE id = NEW.tank_id AND vehicle_id = NEW.vehicle_id;
  IF tank_fuel_type IS NULL OR tank_fuel_type <> NEW.fuel_type OR tank_unit <> NEW.unit
    OR tank_organization_id <> NEW.organization_id OR tank_company_id <> NEW.company_id
    OR tank_branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'fuel record must match its configured tank and scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fuel_records_validate_tank
  BEFORE INSERT OR UPDATE OF tank_id, vehicle_id, fuel_type, unit, organization_id, company_id, branch_id
  ON "fuel_records"
  FOR EACH ROW EXECUTE FUNCTION validate_fuel_record_tank();
