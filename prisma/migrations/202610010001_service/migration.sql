CREATE TYPE "ServiceStatus" AS ENUM ('COMPLETED', 'CANCELED');

CREATE TABLE "services" (
    "id" BIGSERIAL NOT NULL,
    "service_number" VARCHAR(40) NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "vehicle_description" VARCHAR(200),
    "status" "ServiceStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by_id" BIGINT NOT NULL,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "total_hpp" BIGINT NOT NULL DEFAULT 0,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "services_subtotal_nonnegative" CHECK ("subtotal" >= 0),
    CONSTRAINT "services_discount_nonnegative" CHECK ("discount" >= 0),
    CONSTRAINT "services_total_nonnegative" CHECK ("total_amount" >= 0),
    CONSTRAINT "services_hpp_nonnegative" CHECK ("total_hpp" >= 0),
    CONSTRAINT "services_edit_count_once" CHECK ("edit_count" BETWEEN 0 AND 1)
);

CREATE TABLE "service_job_details" (
    "id" BIGSERIAL NOT NULL,
    "service_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" BIGINT NOT NULL,
    CONSTRAINT "service_job_details_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_job_details_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "service_items" (
    "id" BIGSERIAL NOT NULL,
    "service_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "selling_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "unit_hpp_snapshot" BIGINT NOT NULL,
    "line_hpp" BIGINT NOT NULL,
    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "service_items_selling_price_positive" CHECK ("selling_price" > 0),
    CONSTRAINT "service_items_line_amount_consistent" CHECK ("line_amount" = "quantity" * "selling_price"),
    CONSTRAINT "service_items_hpp_positive" CHECK ("unit_hpp_snapshot" > 0 AND "line_hpp" = "quantity" * "unit_hpp_snapshot")
);

CREATE UNIQUE INDEX "services_service_number_key" ON "services"("service_number");
CREATE INDEX "services_status_transaction_at_idx" ON "services"("status", "transaction_at");
CREATE INDEX "services_created_by_id_transaction_at_idx" ON "services"("created_by_id", "transaction_at");
CREATE UNIQUE INDEX "service_job_details_service_id_line_number_key" ON "service_job_details"("service_id", "line_number");
CREATE UNIQUE INDEX "service_items_service_id_spare_part_id_key" ON "service_items"("service_id", "spare_part_id");
CREATE UNIQUE INDEX "service_items_service_id_line_number_key" ON "service_items"("service_id", "line_number");
CREATE INDEX "service_items_spare_part_id_service_id_idx" ON "service_items"("spare_part_id", "service_id");

ALTER TABLE "services" ADD CONSTRAINT "services_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_job_details" ADD CONSTRAINT "service_job_details_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
