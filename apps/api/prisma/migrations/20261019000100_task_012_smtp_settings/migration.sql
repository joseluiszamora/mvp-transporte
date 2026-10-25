CREATE TABLE "installation_smtp_settings" (
  "id" SMALLINT NOT NULL DEFAULT 1,
  "host" VARCHAR(255) NOT NULL,
  "port" INTEGER NOT NULL,
  "secure" BOOLEAN NOT NULL DEFAULT false,
  "require_tls" BOOLEAN NOT NULL DEFAULT false,
  "from_address" VARCHAR(320) NOT NULL,
  "username" VARCHAR(320),
  "password_envelope" JSONB,
  "updated_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "installation_smtp_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "installation_smtp_settings_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "installation_smtp_settings_port_check" CHECK ("port" BETWEEN 1 AND 65535),
  CONSTRAINT "installation_smtp_settings_auth_pair_check" CHECK (("username" IS NULL AND "password_envelope" IS NULL) OR ("username" IS NOT NULL AND "password_envelope" IS NOT NULL)),
  CONSTRAINT "installation_smtp_settings_tls_auth_check" CHECK ("username" IS NULL OR "secure" OR "require_tls"),
  CONSTRAINT "installation_smtp_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
