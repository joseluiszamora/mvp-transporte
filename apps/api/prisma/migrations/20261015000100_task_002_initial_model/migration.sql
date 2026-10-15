-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ORGANIZATION', 'COMPANY', 'BRANCH');

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('ACTIVATION', 'PASSWORD_RECOVERY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "nit" VARCHAR(40),
    "contact" VARCHAR(300),
    "address" VARCHAR(500),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address" VARCHAR(500),
    "contact" VARCHAR(300),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "normalized_email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(500),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "platform_role" "PlatformRole",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "company_id" UUID,
    "branch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "metadata" JSONB,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "successor_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "branch_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" VARCHAR(100),
    "diff" JSONB,
    "request_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "template_code" VARCHAR(100) NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "payload" JSONB NOT NULL,
    "deduplication_key" VARCHAR(200) NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_organization_status_idx" ON "companies"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_organization_id_key" ON "companies"("id", "organization_id");

-- CreateIndex
CREATE INDEX "branches_organization_status_idx" ON "branches"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_company_organization_key" ON "branches"("id", "company_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_code_key" ON "branches"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE INDEX "memberships_user_status_idx" ON "organization_memberships"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_user_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_id_organization_id_key" ON "organization_memberships"("id", "organization_id");

-- CreateIndex
CREATE INDEX "roles_organization_status_idx" ON "roles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_code_key" ON "roles"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_organization_id_key" ON "roles"("id", "organization_id");

-- CreateIndex
CREATE INDEX "role_permissions_organization_permission_idx" ON "role_permissions"("organization_id", "permission_code");

-- CreateIndex
CREATE INDEX "role_assignments_membership_idx" ON "role_assignments"("membership_id", "organization_id");

-- CreateIndex
CREATE INDEX "role_assignments_role_idx" ON "role_assignments"("role_id", "organization_id");

-- CreateIndex
CREATE INDEX "role_assignments_company_scope_idx" ON "role_assignments"("company_id", "scope_type");

-- CreateIndex
CREATE INDEX "role_assignments_branch_scope_idx" ON "role_assignments"("branch_id", "scope_type");

-- CreateIndex
CREATE INDEX "sessions_user_expiry_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_one_unrevoked_per_user" ON "sessions"("user_id") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_expiry_idx" ON "refresh_tokens"("session_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_id_session_key" ON "refresh_tokens"("id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_successor_session_key" ON "refresh_tokens"("successor_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_tokens_user_purpose_expiry_idx" ON "account_tokens"("user_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "audit_events_organization_created_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_deduplication_key_key" ON "email_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_idx" ON "email_outbox"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_membership_id_organization_id_fkey" FOREIGN KEY ("membership_id", "organization_id") REFERENCES "organization_memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_branch_id_company_id_organization_id_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_successor_id_session_id_fkey" FOREIGN KEY ("successor_id", "session_id") REFERENCES "refresh_tokens"("id", "session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_id_company_id_organization_id_fkey" FOREIGN KEY ("branch_id", "company_id", "organization_id") REFERENCES "branches"("id", "company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom PostgreSQL checks not expressible in Prisma Schema Language.
ALTER TABLE "users" ADD CONSTRAINT "users_active_requires_password_check" CHECK ("status" <> 'ACTIVE' OR "password_hash" IS NOT NULL);
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_shape_check" CHECK (("scope_type" = 'ORGANIZATION' AND "company_id" IS NULL AND "branch_id" IS NULL) OR ("scope_type" = 'COMPANY' AND "company_id" IS NOT NULL AND "branch_id" IS NULL) OR ("scope_type" = 'BRANCH' AND "company_id" IS NOT NULL AND "branch_id" IS NOT NULL));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_after_creation_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_not_self_successor_check" CHECK ("successor_id" IS NULL OR "successor_id" <> "id");
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_expiry_after_creation_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_requires_organization_check" CHECK ("company_id" IS NULL OR "organization_id" IS NOT NULL);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_requires_company_check" CHECK ("branch_id" IS NULL OR ("company_id" IS NOT NULL AND "organization_id" IS NOT NULL));
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_attempts_nonnegative_check" CHECK ("attempts" >= 0);
