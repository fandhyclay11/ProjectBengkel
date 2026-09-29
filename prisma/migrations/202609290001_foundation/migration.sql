CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "user_session_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT,
    "actor_username_snapshot" VARCHAR(80),
    "action" VARCHAR(100) NOT NULL,
    "object_type" VARCHAR(100),
    "object_id" VARCHAR(100),
    "before_after" JSONB,
    "context" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_deletion_traces" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT NOT NULL,
    "actor_username_snapshot" VARCHAR(80) NOT NULL,
    "deleted_audit_id" BIGINT NOT NULL,
    "deleted_action" VARCHAR(100) NOT NULL,
    "deleted_object_type" VARCHAR(100),
    "deleted_object_id" VARCHAR(100),
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_deletion_traces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at", "id");
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "audit_logs_object_type_object_id_idx" ON "audit_logs"("object_type", "object_id");
CREATE INDEX "audit_deletion_traces_deleted_at_id_idx" ON "audit_deletion_traces"("deleted_at", "id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_deletion_traces" ADD CONSTRAINT "audit_deletion_traces_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
