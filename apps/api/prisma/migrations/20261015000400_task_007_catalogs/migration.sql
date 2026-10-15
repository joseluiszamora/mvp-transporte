CREATE TYPE "CatalogScope" AS ENUM ('GLOBAL', 'ORGANIZATION', 'COMPANY');

CREATE TABLE "catalogs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "scope" "CatalogScope" NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalogs_scope_context_check" CHECK (
      ("scope" = 'GLOBAL' AND "organization_id" IS NULL AND "company_id" IS NULL AND "is_protected") OR
      ("scope" = 'ORGANIZATION' AND "organization_id" IS NOT NULL AND "company_id" IS NULL AND NOT "is_protected") OR
      ("scope" = 'COMPANY' AND "organization_id" IS NOT NULL AND "company_id" IS NOT NULL AND NOT "is_protected")
    ),
    CONSTRAINT "catalogs_code_normalized_check" CHECK ("code" <> '' AND "code" = upper(btrim("code"))),
    CONSTRAINT "catalogs_name_not_blank_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "catalogs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "catalogs_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "catalogs_global_code_key" ON "catalogs"("code") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "catalogs_organization_code_key" ON "catalogs"("organization_id", "code") WHERE "scope" = 'ORGANIZATION';
CREATE UNIQUE INDEX "catalogs_company_code_key" ON "catalogs"("company_id", "code") WHERE "scope" = 'COMPANY';
CREATE INDEX "catalogs_scope_status_idx" ON "catalogs"("scope", "status");
CREATE INDEX "catalogs_organization_scope_status_idx" ON "catalogs"("organization_id", "scope", "status");
CREATE INDEX "catalogs_company_status_idx" ON "catalogs"("company_id", "status");

CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_items_code_normalized_check" CHECK ("code" <> '' AND "code" = upper(btrim("code"))),
    CONSTRAINT "catalog_items_name_not_blank_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "catalog_items_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "catalog_items_catalog_code_key" ON "catalog_items"("catalog_id", "code");
CREATE INDEX "catalog_items_catalog_status_name_idx" ON "catalog_items"("catalog_id", "status", "name");

INSERT INTO "catalogs" ("id", "code", "name", "description", "scope", "is_protected", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000701', 'EMPLOYEE_DOCUMENT_TYPE', 'Tipos de documento de personal', 'Identificaciones y documentos generales de personal.', 'GLOBAL', true, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000702', 'EMPLOYEE_POSITION', 'Cargos de personal', 'Clasificaciones generales de cargos, ampliables con catálogos propios.', 'GLOBAL', true, CURRENT_TIMESTAMP);

INSERT INTO "catalog_items" ("id", "catalog_id", "code", "name", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000701', 'IDENTITY_CARD', 'Cédula de identidad', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000701', 'PASSPORT', 'Pasaporte', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000701', 'TAX_ID', 'NIT', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000714', '00000000-0000-4000-8000-000000000701', 'PROFESSIONAL_LICENSE', 'Matrícula profesional', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000715', '00000000-0000-4000-8000-000000000701', 'OTHER', 'Otro', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000702', 'ADMINISTRATOR', 'Administrador/a', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000702', 'SUPERVISOR', 'Supervisor/a', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000702', 'ANALYST', 'Analista', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000724', '00000000-0000-4000-8000-000000000702', 'OPERATOR', 'Operador/a', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000725', '00000000-0000-4000-8000-000000000702', 'ASSISTANT', 'Asistente', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000726', '00000000-0000-4000-8000-000000000702', 'OTHER', 'Otro', CURRENT_TIMESTAMP);
