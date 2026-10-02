ALTER TABLE "stock_movements" ADD COLUMN "source_revision" INTEGER;
ALTER TABLE "stock_movements" ADD COLUMN "source_operation" VARCHAR(40);

CREATE TABLE "service_revisions" (
    "id" BIGSERIAL NOT NULL,
    "service_id" BIGINT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "vehicle_description" VARCHAR(200),
    "status" "ServiceStatus" NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "total_hpp" BIGINT NOT NULL,
    "created_by_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_revisions_number_check" CHECK ("revision_number" IN (0, 1))
);
CREATE TABLE "service_revision_jobs" (
    "id" BIGSERIAL NOT NULL,
    "revision_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" BIGINT NOT NULL,
    CONSTRAINT "service_revision_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_revision_jobs_amount_positive" CHECK ("amount" > 0)
);
CREATE TABLE "service_revision_items" (
    "id" BIGSERIAL NOT NULL,
    "revision_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "selling_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "unit_hpp_snapshot" BIGINT NOT NULL,
    "line_hpp" BIGINT NOT NULL,
    CONSTRAINT "service_revision_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_revision_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "service_revision_items_selling_price_positive" CHECK ("selling_price" > 0),
    CONSTRAINT "service_revision_items_consistent" CHECK ("line_amount" = "quantity" * "selling_price" AND "unit_hpp_snapshot" > 0 AND "line_hpp" = "quantity" * "unit_hpp_snapshot")
);
CREATE TABLE "sls_revisions" (
    "id" BIGSERIAL NOT NULL,
    "sls_id" BIGINT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "SlsStatus" NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "total_hpp" BIGINT NOT NULL,
    "created_by_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sls_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sls_revisions_number_check" CHECK ("revision_number" IN (0, 1))
);
CREATE TABLE "sls_revision_items" (
    "id" BIGSERIAL NOT NULL,
    "revision_id" BIGINT NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_code_snapshot" VARCHAR(32) NOT NULL,
    "part_name_snapshot" VARCHAR(150) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "selling_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "unit_hpp_snapshot" BIGINT NOT NULL,
    "line_hpp" BIGINT NOT NULL,
    CONSTRAINT "sls_revision_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sls_revision_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "sls_revision_items_selling_price_positive" CHECK ("selling_price" > 0),
    CONSTRAINT "sls_revision_items_consistent" CHECK ("line_amount" = "quantity" * "selling_price" AND "unit_hpp_snapshot" > 0 AND "line_hpp" = "quantity" * "unit_hpp_snapshot")
);

CREATE UNIQUE INDEX "service_revisions_service_id_revision_number_key" ON "service_revisions"("service_id", "revision_number");
CREATE UNIQUE INDEX "service_revision_jobs_revision_id_line_number_key" ON "service_revision_jobs"("revision_id", "line_number");
CREATE UNIQUE INDEX "service_revision_items_revision_id_spare_part_id_key" ON "service_revision_items"("revision_id", "spare_part_id");
CREATE UNIQUE INDEX "service_revision_items_revision_id_line_number_key" ON "service_revision_items"("revision_id", "line_number");
CREATE UNIQUE INDEX "sls_revisions_sls_id_revision_number_key" ON "sls_revisions"("sls_id", "revision_number");
CREATE UNIQUE INDEX "sls_revision_items_revision_id_spare_part_id_key" ON "sls_revision_items"("revision_id", "spare_part_id");
CREATE UNIQUE INDEX "sls_revision_items_revision_id_line_number_key" ON "sls_revision_items"("revision_id", "line_number");
CREATE INDEX "stock_movements_lineage_idx" ON "stock_movements"("source_type", "source_id", "source_revision", "source_operation");

ALTER TABLE "service_revisions" ADD CONSTRAINT "service_revisions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_revisions" ADD CONSTRAINT "service_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_revision_jobs" ADD CONSTRAINT "service_revision_jobs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "service_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_revision_items" ADD CONSTRAINT "service_revision_items_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "service_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_revision_items" ADD CONSTRAINT "service_revision_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_revisions" ADD CONSTRAINT "sls_revisions_sls_id_fkey" FOREIGN KEY ("sls_id") REFERENCES "sls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_revisions" ADD CONSTRAINT "sls_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_revision_items" ADD CONSTRAINT "sls_revision_items_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "sls_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sls_revision_items" ADD CONSTRAINT "sls_revision_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "service_revisions" ("service_id", "revision_number", "transaction_at", "vehicle_description", "status", "subtotal", "discount", "total_amount", "total_hpp", "created_by_id", "created_at")
SELECT "id", 0, "transaction_at", "vehicle_description", "status", "subtotal", "discount", "total_amount", "total_hpp", "created_by_id", "created_at" FROM "services";
INSERT INTO "service_revision_jobs" ("revision_id", "line_number", "description", "amount")
SELECT r."id", j."line_number", j."description", j."amount" FROM "service_job_details" j JOIN "service_revisions" r ON r."service_id" = j."service_id" AND r."revision_number" = 0;
INSERT INTO "service_revision_items" ("revision_id", "spare_part_id", "line_number", "part_code_snapshot", "part_name_snapshot", "quantity", "selling_price", "line_amount", "unit_hpp_snapshot", "line_hpp")
SELECT r."id", i."spare_part_id", i."line_number", i."part_code_snapshot", i."part_name_snapshot", i."quantity", i."selling_price", i."line_amount", i."unit_hpp_snapshot", i."line_hpp" FROM "service_items" i JOIN "service_revisions" r ON r."service_id" = i."service_id" AND r."revision_number" = 0;
INSERT INTO "sls_revisions" ("sls_id", "revision_number", "transaction_at", "status", "subtotal", "discount", "total_amount", "total_hpp", "created_by_id", "created_at")
SELECT "id", 0, "transaction_at", "status", "subtotal", "discount", "total_amount", "total_hpp", "created_by_id", "created_at" FROM "sls";
INSERT INTO "sls_revision_items" ("revision_id", "spare_part_id", "line_number", "part_code_snapshot", "part_name_snapshot", "quantity", "selling_price", "line_amount", "unit_hpp_snapshot", "line_hpp")
SELECT r."id", i."spare_part_id", i."line_number", i."part_code_snapshot", i."part_name_snapshot", i."quantity", i."selling_price", i."line_amount", i."unit_hpp_snapshot", i."line_hpp" FROM "sls_items" i JOIN "sls_revisions" r ON r."sls_id" = i."sls_id" AND r."revision_number" = 0;

UPDATE "stock_movements" m SET "source_revision" = 0, "source_operation" = 'CREATE'
WHERE "source_type" IN ('SERVICE', 'SLS') AND "movement_type" IN ('SERVICE_ISSUE', 'SLS_ISSUE') AND "source_revision" IS NULL;
