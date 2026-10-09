import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { classifyStock } from "@/server/report-query-service";
import { groupDashboardRows, resolveDashboardPeriod } from "@/server/dashboard-query-service";
import { parseWorkshopDateTime } from "@/server/datetime";

test("R6.3 resolves dashboard presets in workshop-local calendar dates", () => {
  assert.deepEqual(resolveDashboardPeriod({ preset: "today" }, parseWorkshopDateTime("2026-10-05T12:00")), { preset: "today", from: "2026-10-05", to: "2026-10-05" });
  assert.deepEqual(resolveDashboardPeriod({ preset: "week" }, parseWorkshopDateTime("2026-10-07T12:00")), { preset: "week", from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(resolveDashboardPeriod({ preset: "month" }, parseWorkshopDateTime("2026-10-05T12:00")), { preset: "month", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(resolveDashboardPeriod({ preset: "custom", from: "2026-10-02", to: "2026-10-03" }), { preset: "custom", from: "2026-10-02", to: "2026-10-03" });
  assert.throws(() => resolveDashboardPeriod({ preset: "custom", from: "2026-10-03" }), /custom/i);
});

test("R6.3 grouping uses daily, weekly, and monthly thresholds", () => {
  const row = (value: string) => ({ date: parseWorkshopDateTime(`${value}T12:00`), serviceRevenue: 100n, slsRevenue: 50n, hpp: 25n });
  assert.equal(groupDashboardRows([row("2026-01-01")], "2026-01-01", "2026-01-31").mode, "day");
  assert.equal(groupDashboardRows([row("2026-01-01")], "2026-01-01", "2026-02-01").mode, "week");
  assert.equal(groupDashboardRows([row("2026-01-01")], "2026-01-01", "2026-04-01").mode, "month");
});

test("R6.3 chart buckets reconcile with financial totals", () => {
  const grouped = groupDashboardRows([
    { date: parseWorkshopDateTime("2026-10-01T23:59"), serviceRevenue: 100n, slsRevenue: 0n, hpp: 20n },
    { date: parseWorkshopDateTime("2026-10-02T00:00"), serviceRevenue: 0n, slsRevenue: 50n, hpp: 10n },
  ], "2026-10-01", "2026-10-02");
  assert.equal(grouped.buckets.reduce((sum, item) => sum + BigInt(item.serviceRevenue), 0n), 100n);
  assert.equal(grouped.buckets.reduce((sum, item) => sum + BigInt(item.slsRevenue), 0n), 50n);
  assert.equal(grouped.buckets.reduce((sum, item) => sum + BigInt(item.grossProfit!), 0n), 120n);
});

test("R6.3 stock boundaries classify equality as low and negative as minus", () => {
  assert.deepEqual(classifyStock(5n, 5n), { isLow: true, isMinus: false });
  assert.deepEqual(classifyStock(-1n, 5n), { isLow: true, isMinus: true });
  assert.deepEqual(classifyStock(6n, 5n), { isLow: false, isMinus: false });
});

test("R6.3 calculates historical HPP and current inventory value without changing profit formulas", async () => {
  const { getDashboard } = await import("@/server/dashboard-query-service");
  const repository = {
    service: { findMany: async ({ where }: { where: { transactionAt: { gte: Date; lt: Date } } }) => where.transactionAt.gte < new Date("2026-10-01T00:00:00Z") ? [{ transactionAt: new Date("2026-10-01T04:00:00Z"), totalAmount: 1000n, totalHpp: 300n }] : [] },
    sls: { findMany: async ({ where }: { where: { transactionAt: { gte: Date; lt: Date } } }) => where.transactionAt.gte < new Date("2026-10-01T00:00:00Z") ? [{ transactionAt: new Date("2026-10-01T05:00:00Z"), totalAmount: 500n, totalHpp: 200n }] : [] },
    expense: { findMany: async () => [{ transactionAt: new Date("2026-10-01T04:00:00Z"), totalAmount: 125n }] },
    purchase: { count: async ({ where }: { where: { status: string } }) => where.status === "DRAFT" ? 3 : 0 },
    sparePart: { findMany: async ({ where }: { where?: { isActive?: boolean } }) => where?.isActive ? [] : [{ stockOnHand: 4n, averageCost: 100n }, { stockOnHand: 3n, averageCost: null }, { stockOnHand: 2n, averageCost: 50n }] },
  } as never;
  const result = await getDashboard("ADMIN", { preset: "custom", from: "2026-10-01", to: "2026-10-01" }, repository);
  assert.equal(result.kpis.expenseTotal, "125");
  assert.equal(result.kpis.hppPenjualan, "500");
  assert.equal(result.kpis.grossProfit, "1000");
  assert.equal(result.kpis.netProfit, "875");
  assert.equal(result.kpis.inventoryValue, "500");
  const otherPeriod = await getDashboard("ADMIN", { preset: "custom", from: "2026-10-02", to: "2026-10-02" }, repository);
  assert.equal(otherPeriod.kpis.hppPenjualan, "0");
  assert.equal(otherPeriod.kpis.inventoryValue, "500");
  assert.equal("minusStockCount" in result.kpis, false);
  assert.equal("minusStockParts" in result.monitoring, false);
});
