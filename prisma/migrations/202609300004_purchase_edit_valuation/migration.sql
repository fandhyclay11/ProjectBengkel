ALTER TABLE "stock_movements" ADD COLUMN "valuation_delta" BIGINT;

DO $$
DECLARE
  part_row RECORD;
  movement_row RECORD;
  running_stock NUMERIC;
  running_average NUMERIC;
  before_value NUMERIC;
  after_value NUMERIC;
  next_stock NUMERIC;
  next_average NUMERIC;
  value_delta NUMERIC;
BEGIN
  FOR part_row IN SELECT id, stock_on_hand, average_cost FROM spare_parts ORDER BY id LOOP
    running_stock := 0;
    running_average := NULL;
    FOR movement_row IN
      SELECT id, quantity, unit_cost FROM stock_movements
      WHERE spare_part_id = part_row.id ORDER BY occurred_at, id
    LOOP
      IF movement_row.unit_cost IS NULL THEN
        RAISE EXCEPTION 'Cannot backfill stock valuation: movement % has no unit cost', movement_row.id;
      END IF;
      before_value := running_stock * COALESCE(running_average, 0);
      next_stock := running_stock + movement_row.quantity;
      IF next_stock < 0 THEN
        RAISE EXCEPTION 'Cannot backfill stock valuation: negative stock for sparepart %', part_row.id;
      END IF;
      IF movement_row.quantity > 0 THEN
        IF running_stock = 0 THEN
          next_average := movement_row.unit_cost;
        ELSE
          next_average := ROUND((before_value + movement_row.quantity * movement_row.unit_cost) / next_stock);
        END IF;
      ELSE
        next_average := running_average;
      END IF;
      after_value := next_stock * COALESCE(next_average, 0);
      value_delta := after_value - before_value;
      IF value_delta < -9223372036854775808 OR value_delta > 9223372036854775807
         OR after_value > 9223372036854775807 THEN
        RAISE EXCEPTION 'Cannot backfill stock valuation: value outside BIGINT for movement %', movement_row.id;
      END IF;
      UPDATE stock_movements SET valuation_delta = value_delta::BIGINT WHERE id = movement_row.id;
      running_stock := next_stock;
      running_average := next_average;
    END LOOP;
    IF running_stock <> part_row.stock_on_hand THEN
      RAISE EXCEPTION 'Cannot backfill stock valuation: ledger/projection mismatch for sparepart %', part_row.id;
    END IF;
    IF running_stock > 0 AND running_average IS DISTINCT FROM part_row.average_cost THEN
      RAISE EXCEPTION 'Cannot backfill stock valuation: Average Cost/ledger mismatch for sparepart %', part_row.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE "stock_movements" ALTER COLUMN "valuation_delta" SET NOT NULL;
ALTER TABLE "stock_movements" ALTER COLUMN "unit_cost" DROP NOT NULL;

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_quantity_nonzero";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_unit_cost_positive";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_or_revaluation" CHECK (
  "quantity" <> 0 OR ("movement_type" = 'CORRECTION' AND "valuation_delta" IS NOT NULL)
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_cost_positive_or_null" CHECK (
  "unit_cost" IS NULL OR "unit_cost" > 0
);
