CREATE SEQUENCE "sparepart_code_seq" START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE "spare_parts" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "selling_price" BIGINT NOT NULL,
    "latest_buy_price" BIGINT,
    "average_cost" BIGINT,
    "stock_on_hand" BIGINT NOT NULL DEFAULT 0,
    "minimum_stock" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "spare_parts_latest_buy_price_positive" CHECK ("latest_buy_price" IS NULL OR "latest_buy_price" > 0),
    CONSTRAINT "spare_parts_average_cost_positive" CHECK ("average_cost" IS NULL OR "average_cost" > 0),
    CONSTRAINT "spare_parts_stock_on_hand_nonnegative" CHECK ("stock_on_hand" >= 0),
    CONSTRAINT "spare_parts_minimum_stock_nonnegative" CHECK ("minimum_stock" >= 0)
);

CREATE UNIQUE INDEX "spare_parts_code_key" ON "spare_parts"("code");
CREATE UNIQUE INDEX "spare_parts_normalized_name_key" ON "spare_parts" (lower(btrim("name")));
CREATE INDEX "spare_parts_active_deleted_name_idx" ON "spare_parts"("is_active", "deleted_at", "name");

CREATE TABLE "idempotency_records" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "request_key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_actor_operation_key" ON "idempotency_records"("actor_id", "operation", "request_key");
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
