ALTER TYPE "FileResourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_PHOTO';
ALTER TYPE "FileResourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_DOCUMENT';

ALTER TABLE "files"
  ADD CONSTRAINT "files_id_organization_company_key" UNIQUE ("id", "organization_id", "company_id");

CREATE TABLE "employees" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "internal_code" VARCHAR(60) NOT NULL,
  "first_names" VARCHAR(120) NOT NULL,
  "last_names" VARCHAR(120) NOT NULL,
  "personal_document_number" VARCHAR(80),
  "personal_phone" VARCHAR(40),
  "personal_email" VARCHAR(320),
  "personal_address" VARCHAR(500),
  "position_id" UUID,
  "hire_date" DATE NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "user_id" UUID,
  "photo_file_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employees_internal_code_check" CHECK ("internal_code" = upper(btrim("internal_code")) AND btrim("internal_code") <> ''),
  CONSTRAINT "employees_first_names_check" CHECK (btrim("first_names") <> '' AND "first_names" = btrim("first_names")),
  CONSTRAINT "employees_last_names_check" CHECK (btrim("last_names") <> '' AND "last_names" = btrim("last_names")),
  CONSTRAINT "employees_personal_email_check" CHECK ("personal_email" IS NULL OR (length("personal_email") <= 320 AND "personal_email" = lower(btrim("personal_email")))),
  CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employees_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employees_membership_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employees_position_fkey" FOREIGN KEY ("position_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employees_photo_scope_fkey" FOREIGN KEY ("photo_file_id", "organization_id", "company_id") REFERENCES "files"("id", "organization_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employees_company_internal_code_key" ON "employees"("organization_id", "company_id", "internal_code");
CREATE UNIQUE INDEX "employees_organization_user_key" ON "employees"("organization_id", "user_id");
CREATE UNIQUE INDEX "employees_photo_file_id_key" ON "employees"("photo_file_id");
CREATE UNIQUE INDEX "employees_photo_file_scope_key" ON "employees"("photo_file_id", "organization_id", "company_id");
CREATE UNIQUE INDEX "employees_id_organization_company_key" ON "employees"("id", "organization_id", "company_id");
CREATE INDEX "employees_scope_status_name_idx" ON "employees"("organization_id", "company_id", "status", "last_names", "first_names");

CREATE TABLE "employee_branch_assignments" (
  "employee_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_branch_assignments_pkey" PRIMARY KEY ("employee_id", "branch_id"),
  CONSTRAINT "employee_branch_assignments_employee_fkey" FOREIGN KEY ("employee_id", "organization_id", "company_id") REFERENCES "employees"("id", "organization_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_branch_assignments_branch_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "employee_branch_assignments_scope_idx" ON "employee_branch_assignments"("organization_id", "company_id", "branch_id", "employee_id");

CREATE TABLE "employee_documents" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "type_id" UUID NOT NULL,
  "issued_at" DATE,
  "expires_at" DATE,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_documents_dates_check" CHECK ("issued_at" IS NULL OR "expires_at" IS NULL OR "expires_at" >= "issued_at"),
  CONSTRAINT "employee_documents_employee_fkey" FOREIGN KEY ("employee_id", "organization_id", "company_id") REFERENCES "employees"("id", "organization_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_documents_file_fkey" FOREIGN KEY ("file_id", "organization_id", "company_id") REFERENCES "files"("id", "organization_id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_documents_type_fkey" FOREIGN KEY ("type_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_documents_uploader_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_documents_file_id_key" ON "employee_documents"("file_id");
CREATE UNIQUE INDEX "employee_documents_file_scope_key" ON "employee_documents"("file_id", "organization_id", "company_id");
CREATE INDEX "employee_documents_employee_created_idx" ON "employee_documents"("employee_id", "created_at");

CREATE FUNCTION validate_employee_catalog_item() RETURNS trigger AS $$
DECLARE
  expected_code TEXT;
  item_status "RecordStatus";
  catalog_status "RecordStatus";
  item_scope "CatalogScope";
  item_organization UUID;
  item_company UUID;
BEGIN
  IF TG_TABLE_NAME = 'employees' THEN
    IF NEW.position_id IS NULL THEN RETURN NEW; END IF;
    expected_code := 'EMPLOYEE_POSITION';
    SELECT item.status, catalog.status, catalog.scope, catalog.organization_id, catalog.company_id
      INTO item_status, catalog_status, item_scope, item_organization, item_company
      FROM catalog_items AS item JOIN catalogs AS catalog ON catalog.id = item.catalog_id
      WHERE item.id = NEW.position_id AND catalog.code = expected_code;
  ELSE
    expected_code := 'EMPLOYEE_DOCUMENT_TYPE';
    SELECT item.status, catalog.status, catalog.scope, catalog.organization_id, catalog.company_id
      INTO item_status, catalog_status, item_scope, item_organization, item_company
      FROM catalog_items AS item JOIN catalogs AS catalog ON catalog.id = item.catalog_id
      WHERE item.id = NEW.type_id AND catalog.code = expected_code;
  END IF;

  IF item_status IS DISTINCT FROM 'ACTIVE' OR catalog_status IS DISTINCT FROM 'ACTIVE' OR NOT (
    item_scope = 'GLOBAL' OR
    (item_scope = 'ORGANIZATION' AND item_organization = NEW.organization_id) OR
    (item_scope = 'COMPANY' AND item_organization = NEW.organization_id AND item_company = NEW.company_id)
  ) THEN
    RAISE EXCEPTION 'employee catalog item is not active or not available in this scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employees_validate_position"
BEFORE INSERT OR UPDATE OF "position_id", "organization_id", "company_id" ON "employees"
FOR EACH ROW EXECUTE FUNCTION validate_employee_catalog_item();

CREATE TRIGGER "employee_documents_validate_type"
BEFORE INSERT OR UPDATE OF "type_id", "organization_id", "company_id" ON "employee_documents"
FOR EACH ROW EXECUTE FUNCTION validate_employee_catalog_item();

CREATE OR REPLACE FUNCTION validate_file_link_target() RETURNS trigger AS $$
DECLARE
  target_organization_id UUID;
  target_company_id UUID;
  target_branch_id UUID;
  target_status "FileStatus";
  target_employee_status "RecordStatus";
  file_mime TEXT;
BEGIN
  SELECT organization_id, company_id, branch_id, status, detected_mime
    INTO target_organization_id, target_company_id, target_branch_id, target_status, file_mime
    FROM files WHERE id = NEW.file_id;
  IF target_organization_id IS NULL OR target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'file link requires an active file' USING ERRCODE = '23503';
  END IF;

  IF NEW.resource_type = 'COMPANY_ATTACHMENT' THEN
    IF target_branch_id IS NOT NULL OR NEW.resource_id <> target_company_id THEN
      RAISE EXCEPTION 'company attachment link does not match file scope' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.resource_type = 'BRANCH_ATTACHMENT' THEN
    IF target_branch_id IS NULL OR NEW.resource_id <> target_branch_id THEN
      RAISE EXCEPTION 'branch attachment link does not match file scope' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.resource_type = 'EMPLOYEE_PHOTO' OR NEW.resource_type = 'EMPLOYEE_DOCUMENT' THEN
    SELECT organization_id, company_id, status INTO target_organization_id, target_company_id, target_employee_status
      FROM employees WHERE id = NEW.resource_id;
    IF target_employee_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'employee file link requires an active employee' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM files WHERE id = NEW.file_id AND (organization_id <> target_organization_id OR company_id <> target_company_id OR branch_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'employee file scope does not match the file' USING ERRCODE = '23514';
    END IF;
    IF NEW.resource_type = 'EMPLOYEE_PHOTO' AND file_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'employee photos must be images' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported file resource type' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO "permissions" ("code", "description") VALUES
  ('employees.read', 'Consultar datos laborales'),
  ('employees.personal.read', 'Consultar datos personales de empleados'),
  ('employees.create', 'Crear empleados'),
  ('employees.update', 'Actualizar empleados'),
  ('employees.deactivate', 'Desactivar empleados'),
  ('employee_documents.read', 'Consultar documentos de empleados'),
  ('employee_documents.manage', 'Gestionar documentos de empleados')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";
