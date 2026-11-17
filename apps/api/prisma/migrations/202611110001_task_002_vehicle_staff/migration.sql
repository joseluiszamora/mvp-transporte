CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "vehicles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "branch_id" UUID,
  "plate" VARCHAR(20) NOT NULL,
  "plate_normalized" VARCHAR(20) NOT NULL,
  "vehicle_type" VARCHAR(40) NOT NULL,
  "make" VARCHAR(80) NOT NULL,
  "model" VARCHAR(80) NOT NULL,
  "year" INTEGER,
  "capacity_kg" DECIMAL(12,2) NOT NULL,
  "odometer_km" INTEGER,
  "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicles_capacity_positive_check" CHECK ("capacity_kg" > 0),
  CONSTRAINT "vehicles_odometer_nonnegative_check" CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0),
  CONSTRAINT "vehicles_year_check" CHECK ("year" IS NULL OR "year" BETWEEN 1886 AND 2200)
);

CREATE TABLE "driver_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicles_company_plate_normalized_key" ON "vehicles"("company_id", "plate_normalized");
CREATE INDEX "vehicles_scope_status_idx" ON "vehicles"("organization_id", "company_id", "status");
CREATE INDEX "vehicles_scope_type_idx" ON "vehicles"("organization_id", "company_id", "vehicle_type");
CREATE UNIQUE INDEX "driver_profiles_company_employee_key" ON "driver_profiles"("company_id", "employee_id");
CREATE INDEX "driver_profiles_scope_status_idx" ON "driver_profiles"("organization_id", "company_id", "status");
CREATE UNIQUE INDEX "assistant_profiles_company_employee_key" ON "assistant_profiles"("company_id", "employee_id");
CREATE INDEX "assistant_profiles_scope_status_idx" ON "assistant_profiles"("organization_id", "company_id", "status");
