CREATE TYPE "SlsStatus" AS ENUM ('COMPLETED', 'CANCELED');

CREATE TABLE "sls" (
    "id" BIGSERIAL NOT NULL,
    "sls_number" VARCHAR(40) NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "SlsStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by_id" BIGINT NOT NULL,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "total_hpp" BIGINT NOT NULL DEFAULT 0,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sls_subtotal_nonnegative" CHECK ("subtotal" >= 0),
    CONSTRAINT "sls_discount_nonnegative" CHECK ("discount" >= 0),
    CONSTRAINT "sls_total_nonnegative" CHECK ("total_amount" >= 0),
    CONSTRAINT "sls_hpp_nonnegative" CHECK ("total_hpp" >= 0),
    CONSTRAINT "sls_edit_count_once" CHECK ("edit_count" BETWEEN 0 AND 1)
);

CREATE TABLE "sls_items" (
    "id" BIGSERIAL NOT NULL,
    "sls_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "selling_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "unit_hpp_snapshot" BIGINT NOT NULL,
    "line_hpp" BIGINT NOT NULL,
    CONSTRAINT "sls_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sls_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "sls_items_selling_price_positive" CHECK ("selling_price" > 0),
    CONSTRAINT "sls_items_line_amount_consistent" CHECK ("line_amount" = "quantity" * "selling_price"),
    CONSTRAINT "sls_items_hpp_positive" CHECK ("unit_hpp_snapshot" > 0 AND "line_hpp" = "quantity" * "unit_hpp_snapshot")
);

CREATE UNIQUE INDEX "sls_sls_number_key" ON "sls"("sls_number");
CREATE INDEX "sls_status_transaction_at_idx" ON "sls"("status", "transaction_at");
CREATE INDEX "sls_created_by_id_transaction_at_idx" ON "sls"("created_by_id", "transaction_at");
CREATE UNIQUE INDEX "sls_items_sls_id_spare_part_id_key" ON "sls_items"("sls_id", "spare_part_id");
CREATE UNIQUE INDEX "sls_items_sls_id_line_number_key" ON "sls_items"("sls_id", "line_number");
CREATE INDEX "sls_items_spare_part_id_sls_id_idx" ON "sls_items"("spare_part_id", "sls_id");

ALTER TABLE "sls" ADD CONSTRAINT "sls_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_items" ADD CONSTRAINT "sls_items_sls_id_fkey" FOREIGN KEY ("sls_id") REFERENCES "sls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_items" ADD CONSTRAINT "sls_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
