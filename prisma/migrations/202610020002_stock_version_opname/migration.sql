ALTER TABLE "spare_parts" ADD COLUMN "stock_version" BIGINT NOT NULL DEFAULT 0;

CREATE TYPE "StockOpnameStatus" AS ENUM ('REVISION', 'FINALIZED', 'APPROVED');

CREATE TABLE "stock_opnames" (
    "id" BIGSERIAL NOT NULL,
    "opname_number" VARCHAR(40) NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "StockOpnameStatus" NOT NULL DEFAULT 'REVISION',
    "created_by_id" BIGINT NOT NULL,
    "finalized_by_id" BIGINT,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "stock_opnames_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_opnames_opname_number_key" ON "stock_opnames"("opname_number");
CREATE INDEX "stock_opnames_status_transaction_at_idx" ON "stock_opnames"("status", "transaction_at");
CREATE INDEX "stock_opnames_created_by_id_transaction_at_idx" ON "stock_opnames"("created_by_id", "transaction_at");
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_opname_items" (
    "id" BIGSERIAL NOT NULL,
    "stock_opname_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "system_stock" BIGINT NOT NULL,
    "physical_stock" BIGINT,
    "difference" BIGINT,
    "captured_stock_version" BIGINT NOT NULL,
    CONSTRAINT "stock_opname_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_opname_items_system_stock_nonnegative" CHECK ("system_stock" >= 0),
    CONSTRAINT "stock_opname_items_physical_stock_nonnegative" CHECK ("physical_stock" IS NULL OR "physical_stock" >= 0),
    CONSTRAINT "stock_opname_items_difference_consistent" CHECK ("physical_stock" IS NULL AND "difference" IS NULL OR "physical_stock" IS NOT NULL AND "difference" = "physical_stock" - "system_stock")
);
CREATE UNIQUE INDEX "stock_opname_items_stock_opname_id_spare_part_id_key" ON "stock_opname_items"("stock_opname_id", "spare_part_id");
CREATE UNIQUE INDEX "stock_opname_items_stock_opname_id_line_number_key" ON "stock_opname_items"("stock_opname_id", "line_number");
CREATE INDEX "stock_opname_items_spare_part_id_stock_opname_id_idx" ON "stock_opname_items"("spare_part_id", "stock_opname_id");
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_stock_opname_id_fkey" FOREIGN KEY ("stock_opname_id") REFERENCES "stock_opnames"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
