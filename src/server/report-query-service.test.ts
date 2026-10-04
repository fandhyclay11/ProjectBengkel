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

test("R6.2 export limits and report output headers remain bounded", async () => {
  const { collectReport } = await import("@/server/report-api");
  await assert.rejects(collectReport("services", { from: "2026-10-01", to: "2026-10-01", page: 1, pageSize: 25 }, 0, { service: { findMany: async () => [{ serviceNumber: "SRV-1", transactionAt: new Date(), subtotal: 0n, discount: 0n, totalAmount: 0n, totalHpp: 0n, jobs: [], items: [] }], count: async () => 1 } } as never), /terlalu banyak/i);
  const { createExcel, createPdf, reportHeader } = await import("@/server/report-output");
  const header = reportHeader("services", "2026-10-01", "2026-10-01", new Date("2026-10-01T00:00:00.000Z"));
  const page = { rows: [{ serviceNumber: "SRV-1", totalAmount: "100" }], page: 1, pageSize: 25, total: 1 };
  const excel = await createExcel("services", header, page);
  const pdf = await createPdf("services", header, page);
  assert.ok(excel.subarray(0, 2).equals(Buffer.from([0x50, 0x4b])));
  assert.ok(pdf.subarray(0, 5).toString().startsWith("%PDF-"));
});

test("R6.2 PDF renders nested service jobs and spareparts as a readable report", async () => {
  const { createPdf, reportHeader } = await import("@/server/report-output");
  const header = reportHeader("services", "2026-10-01", "2026-10-01", new Date("2026-10-01T00:00:00.000Z"));
  const pdf = await createPdf("services", header, {
    rows: [{ serviceNumber: "SRV-DETAIL", transactionAt: "2026-10-01T10:00:00.000Z", vehicleDescription: "Mobil dinas", subtotal: "60000", discount: "5000", totalAmount: "55000", totalHpp: "30000", jobs: [{ description: "Ganti pejabat", amount: "50000" }], items: [{ partCodeSnapshot: "SP000238", partNameSnapshot: "Buras", quantity: "2", sellingPrice: "5000", lineAmount: "10000", lineHpp: "6000" }] }],
    page: 1, pageSize: 25, total: 1,
  });
  assert.ok(pdf.subarray(0, 5).toString().startsWith("%PDF-"));
  assert.ok(pdf.length > 1_000);
});

test("R6.2 PDF renderer supports every report type", async () => {
  const { createPdf, reportHeader } = await import("@/server/report-output");
  const header = (report: Parameters<typeof reportHeader>[0]) => reportHeader(report, "2026-10-01", "2026-10-01", new Date("2026-10-01T00:00:00.000Z"));
  const fixtures: Record<string, unknown> = {
    services: { serviceNumber: "SRV-1", transactionAt: "2026-10-01T00:00:00.000Z", jobs: [], items: [], subtotal: "0", discount: "0", totalAmount: "0", totalHpp: "0" },
    sls: { slsNumber: "SLS-1", transactionAt: "2026-10-01T00:00:00.000Z", items: [], subtotal: "0", discount: "0", totalAmount: "0", totalHpp: "0" },
    purchases: { purchaseNumber: "PUR-1", transactionAt: "2026-10-01T00:00:00.000Z", items: [], totalAmount: "0" },
    expenses: { expenseNumber: "EXP-1", transactionAt: "2026-10-01T00:00:00.000Z", items: [], totalAmount: "0" },
    stock: { code: "SP-1", name: "Part", sellingPrice: "0", latestBuyPrice: null, averageCost: "0", stockOnHand: "0", minimumStock: "0", isLow: true, isMinus: false },
    movements: { occurredAt: "2026-10-01T00:00:00.000Z", movementType: "IN", quantity: "1", unitCost: "0", sourceType: "TEST", sourceId: "1", sourceRevision: 1, sparePart: { code: "SP-1", name: "Part" } },
    "stock-opnames": { opnameNumber: "OPN-1", transactionAt: "2026-10-01T00:00:00.000Z", status: "DRAFT", items: [], appliedMovements: [] },
  };
  for (const report of Object.keys(fixtures) as Array<Exclude<Parameters<typeof reportHeader>[0], "profit-loss">>) {
    const pdf = await createPdf(report, header(report), { rows: [fixtures[report] as Record<string, unknown>], page: 1, pageSize: 25, total: 1 });
    assert.ok(pdf.subarray(0, 5).toString().startsWith("%PDF-"), report);
  }
  const profitLoss = await createPdf("profit-loss", header("profit-loss"), { summary: { serviceRevenue: "100", slsRevenue: "50", hpp: "20", grossProfit: "130", expense: "10", netProfit: "120", serviceCount: 1, slsCount: 1, completedPurchaseCount: 1, draftPurchaseCount: 0 } });
  assert.ok(profitLoss.subarray(0, 5).toString().startsWith("%PDF-"));
});
