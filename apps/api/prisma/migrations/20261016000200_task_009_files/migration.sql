CREATE TYPE "FileStatus" AS ENUM ('ACTIVE', 'DELETE_PENDING');
CREATE TYPE "FileResourceType" AS ENUM ('COMPANY_ATTACHMENT', 'BRANCH_ATTACHMENT');

CREATE TABLE "files" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "branch_id" UUID,
  "storage_key" VARCHAR(36) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "detected_mime" VARCHAR(100) NOT NULL,
  "bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "status" "FileStatus" NOT NULL DEFAULT 'ACTIVE',
  "uploaded_by" UUID NOT NULL,
  "delete_requested_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "files_storage_key_check" CHECK ("storage_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "files_original_name_check" CHECK (
    length(btrim("original_name")) BETWEEN 1 AND 255 AND
    position('/' in "original_name") = 0 AND
    position(chr(92) in "original_name") = 0 AND
    "original_name" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "files_detected_mime_check" CHECK ("detected_mime" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "files_bytes_check" CHECK ("bytes" BETWEEN 1 AND 10485760),
  CONSTRAINT "files_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "files_delete_state_check" CHECK (
    ("status" = 'ACTIVE' AND "delete_requested_at" IS NULL) OR
    ("status" = 'DELETE_PENDING' AND "delete_requested_at" IS NOT NULL)
  ),
  CONSTRAINT "files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "files_company_organization_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "files_branch_company_organization_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");
CREATE INDEX "files_scope_status_created_idx" ON "files"("organization_id", "company_id", "branch_id", "status", "created_at");
CREATE INDEX "files_cleanup_idx" ON "files"("status", "delete_requested_at");

CREATE TABLE "file_links" (
  "id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "resource_type" "FileResourceType" NOT NULL,
  "resource_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "file_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_links_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "file_links_file_id_key" ON "file_links"("file_id");
CREATE INDEX "file_links_resource_created_idx" ON "file_links"("resource_type", "resource_id", "created_at");

CREATE FUNCTION validate_file_link_target() RETURNS trigger AS $$
DECLARE
  target_organization_id UUID;
  target_company_id UUID;
  target_branch_id UUID;
  target_status "FileStatus";
BEGIN
  SELECT organization_id, company_id, branch_id, status
    INTO target_organization_id, target_company_id, target_branch_id, target_status
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
  ELSE
    RAISE EXCEPTION 'unsupported file resource type' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "file_links_validate_target"
BEFORE INSERT OR UPDATE ON "file_links"
FOR EACH ROW EXECUTE FUNCTION validate_file_link_target();
