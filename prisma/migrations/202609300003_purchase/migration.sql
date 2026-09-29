CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED');

CREATE TABLE "purchases" (
    "id" BIGSERIAL NOT NULL,
    "purchase_number" VARCHAR(40) NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "supplier_name" VARCHAR(200) NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchases_total_nonnegative" CHECK ("total_amount" >= 0),
    CONSTRAINT "purchases_edit_count_once" CHECK ("edit_count" BETWEEN 0 AND 1),
    CONSTRAINT "purchases_lifecycle_timestamps" CHECK (
      ("status" = 'DRAFT' AND "confirmed_at" IS NULL) OR
      ("status" IN ('COMPLETED', 'CANCELED') AND "confirmed_at" IS NOT NULL)
    )
);

CREATE TABLE "purchase_items" (
    "id" BIGSERIAL NOT NULL,
    "purchase_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unit_buy_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_items_unit_price_positive" CHECK ("unit_buy_price" > 0),
    CONSTRAINT "purchase_items_line_amount_consistent" CHECK ("line_amount" = "quantity" * "unit_buy_price")
);

CREATE TABLE "document_number_counters" (
    "series" VARCHAR(10) NOT NULL,
    "business_date" VARCHAR(8) NOT NULL,
    "last_number" BIGINT NOT NULL,
    CONSTRAINT "document_number_counters_pkey" PRIMARY KEY ("series", "business_date"),
    CONSTRAINT "document_number_counters_positive" CHECK ("last_number" > 0)
);

CREATE UNIQUE INDEX "purchases_purchase_number_key" ON "purchases"("purchase_number");
CREATE INDEX "purchases_status_transaction_at_idx" ON "purchases"("status", "transaction_at");
CREATE INDEX "purchases_created_by_id_transaction_at_idx" ON "purchases"("created_by_id", "transaction_at");
CREATE UNIQUE INDEX "purchase_items_purchase_id_spare_part_id_key" ON "purchase_items"("purchase_id", "spare_part_id");
CREATE UNIQUE INDEX "purchase_items_purchase_id_line_number_key" ON "purchase_items"("purchase_id", "line_number");
CREATE INDEX "purchase_items_spare_part_id_purchase_id_idx" ON "purchase_items"("spare_part_id", "purchase_id");

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
