CREATE TYPE "StockMovementType" AS ENUM (
    'OPENING_STOCK', 'PURCHASE_RECEIPT', 'SERVICE_ISSUE', 'SLS_ISSUE',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CORRECTION', 'REVERSAL'
);

CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "spare_part_id" BIGINT NOT NULL,
    "movement_type" "StockMovementType" NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" VARCHAR(200) NOT NULL,
    "actor_id" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversal_of_id" BIGINT,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0),
    CONSTRAINT "stock_movements_unit_cost_positive" CHECK ("unit_cost" > 0),
    CONSTRAINT "stock_movements_inbound_positive" CHECK (
      "movement_type" NOT IN ('OPENING_STOCK', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN') OR "quantity" > 0
    ),
    CONSTRAINT "stock_movements_outbound_negative" CHECK (
      "movement_type" NOT IN ('SERVICE_ISSUE', 'SLS_ISSUE', 'ADJUSTMENT_OUT') OR "quantity" < 0
    )
);

CREATE INDEX "stock_movements_part_time_id_idx" ON "stock_movements"("spare_part_id", "occurred_at", "id");
CREATE INDEX "stock_movements_source_idx" ON "stock_movements"("source_type", "source_id");
CREATE INDEX "stock_movements_reversal_of_id_idx" ON "stock_movements"("reversal_of_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_stock_movement_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Stock movements are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_immutable"
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION "reject_stock_movement_mutation"();
