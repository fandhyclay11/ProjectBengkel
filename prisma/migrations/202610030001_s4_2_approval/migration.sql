ALTER TABLE "stock_opnames"
    ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "approved_by_id" BIGINT,
    ADD COLUMN "approved_at" TIMESTAMPTZ(3);

ALTER TABLE "stock_opnames"
    ADD CONSTRAINT "stock_opnames_revision_number_positive" CHECK ("revision_number" > 0);

ALTER TABLE "stock_opnames"
    ADD CONSTRAINT "stock_opnames_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_opname_items"
    ADD COLUMN "verified_system_stock" BIGINT,
    ADD COLUMN "verified_stock_version" BIGINT;

UPDATE "stock_opname_items"
SET "verified_system_stock" = "system_stock",
    "verified_stock_version" = "captured_stock_version";

ALTER TABLE "stock_opname_items"
    ALTER COLUMN "verified_system_stock" SET NOT NULL,
    ALTER COLUMN "verified_stock_version" SET NOT NULL;

ALTER TABLE "stock_opname_items"
    DROP CONSTRAINT "stock_opname_items_difference_consistent";

ALTER TABLE "stock_opname_items"
    ADD CONSTRAINT "stock_opname_items_verified_system_stock_nonnegative" CHECK ("verified_system_stock" >= 0),
    ADD CONSTRAINT "stock_opname_items_verified_stock_version_nonnegative" CHECK ("verified_stock_version" >= 0),
    ADD CONSTRAINT "stock_opname_items_difference_consistent"
      CHECK ("physical_stock" IS NULL AND "difference" IS NULL OR "physical_stock" IS NOT NULL AND "difference" = "physical_stock" - "verified_system_stock");

CREATE TYPE "StockOpnameApprovalStatus" AS ENUM ('IN_PROGRESS', 'APPROVED');

CREATE TABLE "stock_opname_approval_operations" (
    "id" BIGSERIAL NOT NULL,
    "approval_operation_id" VARCHAR(100) NOT NULL,
    "stock_opname_id" BIGINT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "actor_id" BIGINT NOT NULL,
    "operation_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StockOpnameApprovalStatus" NOT NULL,
    "idempotency_operation" VARCHAR(100) NOT NULL,
    "idempotency_request_key" VARCHAR(200) NOT NULL,
    "adjustment_summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_opname_approval_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_opname_approval_operations_revision_positive" CHECK ("revision_number" > 0)
);

CREATE UNIQUE INDEX "stock_opname_approval_operations_approval_operation_id_key"
    ON "stock_opname_approval_operations"("approval_operation_id");
CREATE UNIQUE INDEX "stock_opname_approval_operations_stock_opname_id_revision_number_key"
    ON "stock_opname_approval_operations"("stock_opname_id", "revision_number");
CREATE INDEX "stock_opname_approval_operations_stock_opname_id_operation_at_idx"
    ON "stock_opname_approval_operations"("stock_opname_id", "operation_at");
CREATE INDEX "stock_opname_approval_operations_idempotency_operation_idempotency_request_key_idx"
    ON "stock_opname_approval_operations"("idempotency_operation", "idempotency_request_key");

ALTER TABLE "stock_opname_approval_operations"
    ADD CONSTRAINT "stock_opname_approval_operations_stock_opname_id_fkey"
    FOREIGN KEY ("stock_opname_id") REFERENCES "stock_opnames"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "stock_opname_approval_operations_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
