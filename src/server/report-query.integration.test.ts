import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { getFinancialSummary, listMovementReport, listServiceReport, listStockOpnameReport, listStockReport } from "@/server/report-query-service";
import { parseWorkshopDateTime, workshopDateKey } from "@/server/datetime";

test("R6.1 report datasets reconcile financial, stock, movement, and SO sources", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_r61_${suffix}`, role: "ADMIN", passwordHash: `not-a-login-${suffix}` } });
  try {
    await prisma.$transaction(async (tx) => {
      const part = await tx.sparePart.create({ data: { code: `R61${suffix}`, name: `R61 Part ${suffix}`, sellingPrice: 1000n, latestBuyPrice: 700n, averageCost: 500n, stockOnHand: 8n, minimumStock: 8n, stockVersion: 1n } });
      const date = parseWorkshopDateTime("2000-10-01T23:59");
      await tx.service.create({ data: { serviceNumber: `SRV-R61-${suffix}`, transactionAt: date, status: "COMPLETED", createdById: user.id, subtotal: 1000n, discount: 100n, totalAmount: 900n, totalHpp: 300n, jobs: { create: { lineNumber: 1, description: "R61 service", amount: 900n } }, items: { create: { sparePartId: part.id, lineNumber: 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: 1n, sellingPrice: 100n, lineAmount: 100n, unitHppSnapshot: 300n, lineHpp: 300n } } } });
      await tx.service.create({ data: { serviceNumber: `SRV-R61-C-${suffix}`, transactionAt: date, status: "CANCELED", createdById: user.id, subtotal: 999n, discount: 0n, totalAmount: 999n, totalHpp: 999n, jobs: { create: { lineNumber: 1, description: "Canceled", amount: 999n } } } });
      await tx.sls.create({ data: { slsNumber: `SLS-R61-${suffix}`, transactionAt: date, status: "COMPLETED", createdById: user.id, subtotal: 500n, discount: 0n, totalAmount: 500n, totalHpp: 200n, items: { create: { sparePartId: part.id, lineNumber: 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: 1n, sellingPrice: 500n, lineAmount: 500n, unitHppSnapshot: 200n, lineHpp: 200n } } } });
      await tx.purchase.create({ data: { purchaseNumber: `PUR-R61-${suffix}`, transactionAt: date, supplierName: "R61", status: "COMPLETED", createdById: user.id, totalAmount: 700n, confirmedAt: date, items: { create: { sparePartId: part.id, lineNumber: 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: 1n, unitBuyPrice: 700n, lineAmount: 700n } } } });
      await tx.purchase.create({ data: { purchaseNumber: `PUR-R61-D-${suffix}`, transactionAt: date, supplierName: "R61", status: "DRAFT", createdById: user.id, totalAmount: 0n } });
      await tx.expense.create({ data: { expenseNumber: `EXP-R61-${suffix}`, transactionAt: date, status: "COMPLETED", createdById: user.id, totalAmount: 100n, items: { create: { lineNumber: 1, description: "R61 expense", quantity: "1", unitPrice: 100n, lineAmount: 100n } } } });
      const opname = await tx.stockOpname.create({ data: { opnameNumber: `OPN-R61-${suffix}`, transactionAt: date, status: "APPROVED", createdById: user.id, approvedById: user.id, approvedAt: date, items: { create: { lineNumber: 1, sparePartId: part.id, partCodeSnapshot: part.code, partNameSnapshot: part.name, systemStock: 10n, physicalStock: 8n, difference: -2n, capturedStockVersion: 0n, verifiedSystemStock: 10n, verifiedStockVersion: 0n } } } });
      await tx.stockMovement.create({ data: { sparePartId: part.id, movementType: "ADJUSTMENT_OUT", quantity: -2n, unitCost: 500n, valuationDelta: -1000n, sourceType: "STOCK_OPNAME", sourceId: opname.id.toString(), sourceRevision: 1, sourceOperation: `r61-op-${suffix}`, actorId: user.id } });

      const summary = await getFinancialSummary("ADMIN", { from: "2000-10-01", to: "2000-10-01" }, tx);
      assert.deepEqual(summary, { serviceRevenue: "900", slsRevenue: "500", hpp: "500", grossProfit: "900", expense: "100", netProfit: "800", serviceCount: 1, slsCount: 1, completedPurchaseCount: 1, draftPurchaseCount: 1 });
      const services = await listServiceReport("ADMIN", { from: "2000-10-01", to: "2000-10-01", search: `SRV-R61-${suffix}`, pageSize: 100 }, tx);
      assert.equal(services.total, 1);
      const stock = await listStockReport("ADMIN", { pageSize: 100 }, tx);
      const stockRow = stock.rows.find((row) => (row as { code: string }).code === part.code) as { stockOnHand: string; isLow: boolean };
      assert.equal(stockRow.stockOnHand, "8");
      assert.equal(stockRow.isLow, true);
      const reportDate = workshopDateKey(new Date());
      const movementDate = `${reportDate.slice(0, 4)}-${reportDate.slice(4, 6)}-${reportDate.slice(6, 8)}`;
      const movements = await listMovementReport("ADMIN", { from: movementDate, to: movementDate, sparePartId: part.id.toString(), pageSize: 100 }, tx);
      assert.equal(movements.total, 1);
      const opnameReport = await listStockOpnameReport("ADMIN", { from: "2000-10-01", to: "2000-10-01", pageSize: 100 }, tx);
      const item = ((opnameReport.rows[0] as { items: Array<{ appliedAdjustment: string }> }).items)[0]!;
      assert.equal(item.appliedAdjustment, "-2");
      throw new Error(`R61_ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `R61_ROLLBACK_${suffix}`); }
  await prisma.user.delete({ where: { id: user.id } });
});
