CREATE UNIQUE INDEX "memberships_user_id_id_key"
  ON "organization_memberships"("user_id", "id");

ALTER TABLE "sessions"
  ADD COLUMN "selected_membership_id" UUID,
  ADD CONSTRAINT "sessions_selected_membership_id_user_id_fkey"
    FOREIGN KEY ("user_id", "selected_membership_id")
    REFERENCES "organization_memberships"("user_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_tokens"
  ADD COLUMN "membership_id" UUID,
  ADD CONSTRAINT "account_tokens_membership_id_user_id_fkey"
    FOREIGN KEY ("user_id", "membership_id")
    REFERENCES "organization_memberships"("user_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "account_tokens_membership_expiry_idx"
  ON "account_tokens"("membership_id", "expires_at");

CREATE TABLE "auth_rate_limits" (
  "key_hash" CHAR(64) NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key_hash"),
  CONSTRAINT "auth_rate_limits_attempts_positive" CHECK ("attempts" > 0)
);

INSERT INTO "permissions" ("code", "description")
VALUES
  ('organizations.read', 'Consultar organizaciones de plataforma'),
  ('organizations.create', 'Crear organizaciones en plataforma'),
  ('organizations.update', 'Actualizar organizaciones en plataforma'),
  ('organizations.activate', 'Activar organizaciones en plataforma'),
  ('organizations.deactivate', 'Desactivar organizaciones en plataforma'),
  ('companies.read', 'Consultar empresas'),
  ('companies.create', 'Crear empresas'),
  ('companies.update', 'Actualizar empresas'),
  ('companies.deactivate', 'Desactivar empresas'),
  ('branches.read', 'Consultar sucursales'),
  ('branches.create', 'Crear sucursales'),
  ('branches.update', 'Actualizar sucursales'),
  ('branches.deactivate', 'Desactivar sucursales'),
  ('users.read', 'Consultar usuarios'),
  ('users.create', 'Crear usuarios'),
  ('users.update', 'Actualizar usuarios'),
  ('users.deactivate', 'Desactivar usuarios'),
  ('roles.read', 'Consultar roles'),
  ('roles.create', 'Crear roles'),
  ('roles.update', 'Actualizar roles'),
  ('roles.assign', 'Asignar roles'),
  ('employees.read', 'Consultar datos laborales'),
  ('employees.personal.read', 'Consultar datos personales de empleados'),
  ('employees.create', 'Crear empleados'),
  ('employees.update', 'Actualizar empleados'),
  ('employees.deactivate', 'Desactivar empleados'),
  ('employee_documents.read', 'Consultar documentos de empleados'),
  ('employee_documents.manage', 'Gestionar documentos de empleados'),
  ('settings.read', 'Consultar configuración'),
  ('settings.update', 'Actualizar configuración'),
  ('catalogs.read', 'Consultar catálogos'),
  ('catalogs.manage', 'Gestionar catálogos'),
  ('files.upload', 'Cargar archivos privados'),
  ('files.read', 'Consultar archivos autorizados'),
  ('files.download', 'Descargar archivos autorizados'),
  ('files.delete', 'Eliminar archivos autorizados'),
  ('audit.read', 'Consultar auditoría'),
  ('notifications.read', 'Consultar notificaciones'),
  ('notifications.manage', 'Gestionar notificaciones')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "email_templates" ("code", "subject", "text_body", "variables", "created_at", "updated_at")
VALUES (
  'account.membership_invitation',
  'Invitación a {{organizationName}}',
  'Hola {{displayName}},\n\nTe invitaron a formar parte de {{organizationName}}. Para aceptar la invitación, abre este enlace:\n{{actionUrl}}\n\nSi no esperabas esta invitación, puedes ignorar este mensaje.',
  ARRAY['displayName', 'organizationName', 'actionUrl'],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "subject" = EXCLUDED."subject",
  "text_body" = EXCLUDED."text_body",
  "variables" = EXCLUDED."variables",
  "updated_at" = CURRENT_TIMESTAMP;
