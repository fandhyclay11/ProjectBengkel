import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpense, calculateLine, ExpenseCalculationError } from "@/server/expense-calculation";

test("Expense uses NUMERIC-scale quantity and half-up rounding per line", () => {
  const result = calculateExpense([
    { description: "A", quantity: "1.234", unitPrice: "100" },
    { description: "B", quantity: "2.005", unitPrice: "100" },
  ]);
  assert.deepEqual(result.items.map((item) => item.lineAmount), [123n, 201n]);
  assert.equal(result.totalAmount, 324n);
});

test("Expense rejects invalid quantity and unit price", () => {
  for (const quantity of ["0", "-1", "1.0000", "1e2"]) assert.throws(() => calculateLine(quantity, "100"), ExpenseCalculationError);
  for (const price of ["0", "-1", "1.5"]) assert.throws(() => calculateLine("1", price), ExpenseCalculationError);
});

test("Expense protects BIGINT overflow", () => {
  assert.throws(() => calculateLine("9999999999999999999.999", "9999999999999999999"), ExpenseCalculationError);
  assert.throws(() => calculateExpense([{ description: "overflow", quantity: "9223372036854775.808", unitPrice: "1000" }]), ExpenseCalculationError);
});
