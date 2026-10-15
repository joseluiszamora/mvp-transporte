CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "EmailDeliveryOutcome" AS ENUM ('SENT', 'FAILED');

ALTER TABLE "audit_events" ADD COLUMN "actor_type" "AuditActorType";
UPDATE "audit_events"
SET "actor_type" = CASE WHEN "actor_id" IS NULL THEN 'SYSTEM'::"AuditActorType" ELSE 'USER'::"AuditActorType" END;
ALTER TABLE "audit_events" ALTER COLUMN "actor_type" SET NOT NULL;
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_type_context_check"
  CHECK (("actor_type" = 'USER' AND "actor_id" IS NOT NULL) OR ("actor_type" = 'SYSTEM' AND "actor_id" IS NULL));

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_id_fkey";
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_reject_update_delete"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();

CREATE TRIGGER "audit_events_reject_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_audit_event_mutation"();

CREATE TABLE "email_templates" (
  "code" VARCHAR(100) NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "text_body" TEXT NOT NULL,
  "variables" TEXT[] NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("code")
);

INSERT INTO "email_templates" ("code", "subject", "text_body", "variables", "created_at", "updated_at")
VALUES
  (
    'account.activation',
    'Activa tu cuenta',
    'Hola {{displayName}},\n\nPara completar la activación de tu cuenta, abre este enlace:\n{{actionUrl}}\n\nSi no solicitaste esta invitación, puedes ignorar este mensaje.',
    ARRAY['displayName', 'actionUrl'],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'account.recovery',
    'Recupera tu contraseña',
    'Hola {{displayName}},\n\nPara establecer una nueva contraseña, abre este enlace:\n{{actionUrl}}\n\nSi no solicitaste este cambio, puedes ignorar este mensaje.',
    ARRAY['displayName', 'actionUrl'],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'account.password_changed',
    'Tu contraseña fue cambiada',
    'Hola {{displayName}},\n\nLa contraseña de tu cuenta cambió el {{changedAt}}. Si no reconoces esta acción, contacta al administrador de tu organización.',
    ARRAY['displayName', 'changedAt'],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

ALTER TABLE "email_outbox"
  ADD COLUMN "locked_at" TIMESTAMPTZ(6),
  ADD COLUMN "lock_token" UUID,
  ADD COLUMN "last_error_code" VARCHAR(80),
  ADD CONSTRAINT "email_outbox_processing_lock_check"
    CHECK (("status" = 'PROCESSING' AND "locked_at" IS NOT NULL AND "lock_token" IS NOT NULL) OR ("status" <> 'PROCESSING' AND "locked_at" IS NULL AND "lock_token" IS NULL));

CREATE TABLE "email_deliveries" (
  "id" UUID NOT NULL,
  "outbox_id" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "outcome" "EmailDeliveryOutcome" NOT NULL,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_deliveries_attempt_positive_check" CHECK ("attempt" > 0),
  CONSTRAINT "email_deliveries_result_error_check" CHECK (("outcome" = 'SENT' AND "error_code" IS NULL) OR ("outcome" = 'FAILED' AND "error_code" IS NOT NULL)),
  CONSTRAINT "email_deliveries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "email_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "email_deliveries_outbox_attempt_key" ON "email_deliveries"("outbox_id", "attempt");
CREATE INDEX "email_deliveries_outbox_created_idx" ON "email_deliveries"("outbox_id", "created_at");
CREATE INDEX "email_outbox_claim_idx" ON "email_outbox"("status", "next_attempt_at", "created_at");

ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_template_code_fkey"
  FOREIGN KEY ("template_code") REFERENCES "email_templates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
