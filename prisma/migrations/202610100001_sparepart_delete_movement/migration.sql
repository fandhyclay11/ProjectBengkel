ALTER TYPE "StockMovementType" ADD VALUE 'DELETE';

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_outbound_negative";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_outbound_negative" CHECK (
  "movement_type" NOT IN ('SERVICE_ISSUE', 'SLS_ISSUE', 'ADJUSTMENT_OUT', 'DELETE') OR "quantity" < 0
);
