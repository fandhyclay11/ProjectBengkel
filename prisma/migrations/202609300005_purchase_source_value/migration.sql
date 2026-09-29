ALTER TABLE "stock_movements" ADD COLUMN "purchase_value_delta" BIGINT;

-- Preserve the actual Purchase price contribution separately from the rounded
-- change to the inventory valuation projection.
UPDATE "stock_movements"
SET "purchase_value_delta" = ("quantity" * "unit_cost")::BIGINT
WHERE "source_type" = 'PURCHASE'
  AND "movement_type" = 'PURCHASE_RECEIPT'
  AND "quantity" > 0;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_value_source" CHECK (
  ("source_type" IN ('PURCHASE', 'PURCHASE_EDIT', 'PURCHASE_CANCEL') AND "purchase_value_delta" IS NOT NULL)
  OR ("source_type" NOT IN ('PURCHASE', 'PURCHASE_EDIT', 'PURCHASE_CANCEL') AND "purchase_value_delta" IS NULL)
);
