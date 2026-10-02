CREATE TYPE "ExpenseStatus" AS ENUM ('COMPLETED', 'CANCELED');

CREATE TABLE "expenses" (
    "id" BIGSERIAL NOT NULL,
    "expense_number" VARCHAR(40) NOT NULL,
    "transaction_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by_id" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "general_note" VARCHAR(1000),
    "external_receipt_number" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expenses_expense_number_key" ON "expenses"("expense_number");
CREATE INDEX "expenses_status_transaction_at_idx" ON "expenses"("status", "transaction_at");
CREATE INDEX "expenses_created_by_id_transaction_at_idx" ON "expenses"("created_by_id", "transaction_at");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_items" (
    "id" BIGSERIAL NOT NULL,
    "expense_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_items_expense_id_line_number_key" ON "expense_items"("expense_id", "line_number");
CREATE INDEX "expense_items_expense_id_line_number_idx" ON "expense_items"("expense_id", "line_number");
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_unit_price_positive" CHECK ("unit_price" > 0);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_line_amount_positive" CHECK ("line_amount" > 0);
