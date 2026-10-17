CREATE TYPE "SettingScopeType" AS ENUM ('INSTALLATION', 'ORGANIZATION', 'COMPANY', 'BRANCH');
CREATE TYPE "SettingValueType" AS ENUM ('STRING');

CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "scope_type" "SettingScopeType" NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "branch_id" UUID,
    "key" VARCHAR(80) NOT NULL,
    "value_type" "SettingValueType" NOT NULL DEFAULT 'STRING',
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settings_scope_shape_check" CHECK (
      ("scope_type" = 'INSTALLATION' AND "organization_id" IS NULL AND "company_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'ORGANIZATION' AND "organization_id" IS NOT NULL AND "company_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'COMPANY' AND "organization_id" IS NOT NULL AND "company_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'BRANCH' AND "organization_id" IS NOT NULL AND "company_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "settings_key_scope_check" CHECK (
      (("key" IN ('locale', 'currency', 'timeZone')) AND "scope_type" IN ('INSTALLATION', 'ORGANIZATION', 'COMPANY', 'BRANCH')) OR
      (("key" IN ('identity.name', 'identity.logoUrl', 'identity.brandColor')) AND "scope_type" = 'COMPANY')
    ),
    CONSTRAINT "settings_value_check" CHECK (
      ("key" = 'locale' AND "value" = '"es"'::jsonb) OR
      ("key" = 'currency' AND "value" = '"BOB"'::jsonb) OR
      ("key" = 'timeZone' AND "value" = '"America/La_Paz"'::jsonb) OR
      ("key" = 'identity.name' AND jsonb_typeof("value") = 'string' AND length(btrim("value" #>> '{}')) BETWEEN 1 AND 160) OR
      ("key" = 'identity.logoUrl' AND jsonb_typeof("value") = 'string' AND length("value" #>> '{}') <= 500 AND "value" #>> '{}' ~ '^https://[^[:space:]]+$') OR
      ("key" = 'identity.brandColor' AND jsonb_typeof("value") = 'string' AND "value" #>> '{}' ~ '^#[0-9A-Fa-f]{6}$')
    ),
    CONSTRAINT "settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "settings_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "settings_branch_company_organization_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "settings_installation_key_key" ON "settings"("key") WHERE "scope_type" = 'INSTALLATION';
CREATE UNIQUE INDEX "settings_organization_key_key" ON "settings"("organization_id", "key") WHERE "scope_type" = 'ORGANIZATION';
CREATE UNIQUE INDEX "settings_company_key_key" ON "settings"("company_id", "key") WHERE "scope_type" = 'COMPANY';
CREATE UNIQUE INDEX "settings_branch_key_key" ON "settings"("branch_id", "key") WHERE "scope_type" = 'BRANCH';
CREATE INDEX "settings_organization_scope_key_idx" ON "settings"("organization_id", "scope_type", "key");

INSERT INTO "settings" ("id", "scope_type", "key", "value_type", "value", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000801', 'INSTALLATION', 'locale', 'STRING', '"es"'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000802', 'INSTALLATION', 'currency', 'STRING', '"BOB"'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000803', 'INSTALLATION', 'timeZone', 'STRING', '"America/La_Paz"'::jsonb, CURRENT_TIMESTAMP);

CREATE TABLE "business_hours" (
    "id" UUID NOT NULL,
    "scope_type" "SettingScopeType" NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "weekday" SMALLINT NOT NULL,
    "intervals" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "business_hours_scope_shape_check" CHECK (
      ("scope_type" = 'COMPANY' AND "branch_id" IS NULL) OR
      ("scope_type" = 'BRANCH' AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "business_hours_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "business_hours_intervals_check" CHECK (jsonb_typeof("intervals") = 'array' AND jsonb_array_length("intervals") <= 2),
    CONSTRAINT "business_hours_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_hours_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_hours_branch_company_organization_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_hours_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_hours_company_weekday_key" ON "business_hours"("company_id", "weekday") WHERE "scope_type" = 'COMPANY' AND "branch_id" IS NULL;
CREATE UNIQUE INDEX "business_hours_branch_weekday_key" ON "business_hours"("branch_id", "weekday") WHERE "scope_type" = 'BRANCH';
CREATE INDEX "business_hours_scope_weekday_idx" ON "business_hours"("organization_id", "company_id", "branch_id", "weekday");

CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "branch_id" UUID,
    "document_type" VARCHAR(60) NOT NULL,
    "period" VARCHAR(16) NOT NULL,
    "prefix" VARCHAR(24) NOT NULL DEFAULT '',
    "padding" SMALLINT NOT NULL DEFAULT 0,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "number_sequences_scope_shape_check" CHECK (
      ("scope_type" = 'ORGANIZATION' AND "company_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'COMPANY' AND "company_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'BRANCH' AND "company_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "number_sequences_document_type_check" CHECK ("document_type" <> '' AND "document_type" = upper(btrim("document_type")) AND "document_type" ~ '^[A-Z0-9][A-Z0-9._-]{0,59}$'),
    CONSTRAINT "number_sequences_period_check" CHECK ("period" = 'ALL' OR "period" ~ '^[0-9]{4}(-[0-9]{2})?$'),
    CONSTRAINT "number_sequences_prefix_check" CHECK ("prefix" ~ '^[A-Za-z0-9._/-]{0,24}$'),
    CONSTRAINT "number_sequences_padding_check" CHECK ("padding" BETWEEN 0 AND 12),
    CONSTRAINT "number_sequences_next_value_check" CHECK ("next_value" >= 1),
    CONSTRAINT "number_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "number_sequences_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "number_sequences_branch_company_organization_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "number_sequences_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "number_sequences_organization_key_key" ON "number_sequences"("organization_id", "document_type", "period") WHERE "scope_type" = 'ORGANIZATION';
CREATE UNIQUE INDEX "number_sequences_company_key_key" ON "number_sequences"("company_id", "document_type", "period") WHERE "scope_type" = 'COMPANY';
CREATE UNIQUE INDEX "number_sequences_branch_key_key" ON "number_sequences"("branch_id", "document_type", "period") WHERE "scope_type" = 'BRANCH';
CREATE INDEX "number_sequences_scope_document_idx" ON "number_sequences"("organization_id", "company_id", "branch_id", "document_type");

CREATE FUNCTION protect_number_sequence_history() RETURNS trigger AS $$
BEGIN
  IF NEW.next_value < OLD.next_value OR NEW.next_value > OLD.next_value + 1 THEN
    RAISE EXCEPTION 'number sequence counter must increase by at most one' USING ERRCODE = '23514';
  END IF;
  IF OLD.next_value > 1 AND (
    NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.company_id IS DISTINCT FROM OLD.company_id OR
    NEW.branch_id IS DISTINCT FROM OLD.branch_id OR
    NEW.document_type IS DISTINCT FROM OLD.document_type OR
    NEW.period IS DISTINCT FROM OLD.period OR
    NEW.prefix IS DISTINCT FROM OLD.prefix OR
    NEW.padding IS DISTINCT FROM OLD.padding
  ) THEN
    RAISE EXCEPTION 'issued number sequence configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "number_sequences_immutable_after_issue"
BEFORE UPDATE ON "number_sequences"
FOR EACH ROW EXECUTE FUNCTION protect_number_sequence_history();
