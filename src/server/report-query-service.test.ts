import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialSummary, classifyStock, groupFinancialByDay, ReportQueryError } from "@/server/report-query-service";
import { parseWorkshopDateTime, workshopDateRange, workshopDateTimeInput } from "@/server/datetime";

test("R6.1 uses inclusive workshop-local date boundaries", () => {
  const range = workshopDateRange("2026-10-01", "2026-10-01");
  assert.equal(workshopDateTimeInput(range.from), "2026-10-01T00:00");
  assert.equal(workshopDateTimeInput(range.toExclusive), "2026-10-02T00:00");
  assert.equal(workshopDateTimeInput(parseWorkshopDateTime("2026-10-01T00:00")), "2026-10-01T00:00");
  assert.throws(() => workshopDateRange("2026-10-02", "2026-10-01"));
});

test("R6.1 financial formulas use stored totals and exclude canceled data at query boundary", () => {
  const result = calculateFinancialSummary({ serviceRevenue: 1_000n, slsRevenue: 500n, hpp: 600n, expense: 200n, serviceCount: 1, slsCount: 1, completedPurchaseCount: 2, draftPurchaseCount: 1 });
  assert.deepEqual(result, { serviceRevenue: "1000", slsRevenue: "500", hpp: "600", grossProfit: "900", expense: "200", netProfit: "700", serviceCount: 1, slsCount: 1, completedPurchaseCount: 2, draftPurchaseCount: 1 });
});

test("R6.1 stock classification follows locked thresholds", () => {
  assert.deepEqual(classifyStock(0n, 0n), { isLow: true, isMinus: false });
  assert.deepEqual(classifyStock(-1n, 0n), { isLow: true, isMinus: true });
  assert.deepEqual(classifyStock(1n, 0n), { isLow: false, isMinus: false });
});

test("R6.1 groups financial data by workshop business day", () => {
  const rows = groupFinancialByDay([
    { date: parseWorkshopDateTime("2026-10-01T23:59"), serviceRevenue: 100n, slsRevenue: 0n, hpp: 20n, expense: 5n },
    { date: parseWorkshopDateTime("2026-10-02T00:00"), serviceRevenue: 200n, slsRevenue: 50n, hpp: 30n, expense: 10n },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.grossProfit, "80");
  assert.equal(rows[1]!.netProfit, "210");
});

test("R6.1 rejects USER report query access", async () => {
  const { getFinancialSummary } = await import("@/server/report-query-service");
  await assert.rejects(getFinancialSummary("USER", { from: "2026-10-01", to: "2026-10-01" }), (error: unknown) => error instanceof ReportQueryError && error.kind === "FORBIDDEN");
});
