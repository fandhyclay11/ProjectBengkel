import "dotenv/config";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement, listMovementsForAdmin, StockServiceError } from "@/server/stock-service";

test("stock service posts an immutable ledger and keeps its balance projection atomic", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for database integration tests");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const admin = await prisma.user.create({
    data: { username: `it_stock_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`Integration-${suffix}-Password!`) },
  });
  const sourceId = `i2.2-${suffix}`;
  const rollbackMessage = `ROLLBACK_STOCK_FIXTURE_${suffix}`;
  let partId: bigint | undefined;

  try {
    try {
      await prisma.$transaction(async (tx) => {
        const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
        const part = await tx.sparePart.create({
          data: { code: `SP${sequence!.value.toString().padStart(6, "0")}`, name: `Stock Test ${suffix}`, sellingPrice: 1000n, minimumStock: 0n },
        });
        partId = part.id;
        const opening = await applyStockMovement(tx, {
          sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 1n, unitCost: 1200n,
          sourceType: "INTEGRATION_TEST", sourceId, actorId: admin.id,
        });
        assert.equal(opening.currentStock, 1n);
        assert.equal(opening.averageCost, 1200n, "opening unit cost initializes Average Cost");

        const receipt = await applyStockMovement(tx, {
          sparePartId: part.id, movementType: "PURCHASE_RECEIPT", quantity: 1n, unitCost: 1401n,
          sourceType: "INTEGRATION_TEST", sourceId: `${sourceId}-receipt`, actorId: admin.id,
        });
        assert.equal(receipt.currentStock, 2n);
        assert.equal(receipt.averageCost, 1301n, "weighted Average Cost rounds half up to a whole Rupiah");

        const issue = await applyStockMovement(tx, {
          sparePartId: part.id, movementType: "SERVICE_ISSUE", quantity: -1n,
          sourceType: "INTEGRATION_TEST", sourceId: `${sourceId}-issue`, actorId: admin.id,
        });
        assert.equal(issue.currentStock, 1n);
        assert.equal(issue.unitCost, 1301n);
        assert.equal(issue.averageCost, 1301n, "stock issue records current cost without changing Average Cost");

        await assert.rejects(
          applyStockMovement(tx, {
            sparePartId: part.id, movementType: "SERVICE_ISSUE", quantity: -2n,
            sourceType: "INTEGRATION_TEST", sourceId: `${sourceId}-short`, actorId: admin.id,
          }),
          (error: unknown) => error instanceof StockServiceError && error.kind === "INSUFFICIENT_STOCK",
        );

        const current = await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } });
        const movements = await tx.stockMovement.findMany({ where: { sparePartId: part.id } });
        assert.equal(current.stockOnHand, 1n);
        assert.equal(movements.reduce((total, movement) => total + movement.quantity, 0n), current.stockOnHand,
          "ledger quantity reconciles with current-stock projection");
        assert.equal(movements.length, 3, "insufficient stock creates no movement");
        const cardRows = await listMovementsForAdmin(part.id, 20, tx);
        assert.equal(cardRows.length, 3, "Admin stock-card query returns movements for the selected part");
        assert.equal(cardRows[0]?.code, part.code);
        assert.ok(cardRows.some((row) => row.type === "PURCHASE_RECEIPT" && row.quantity === "1"));
        assert.equal((await listMovementsForAdmin(part.id + 1n, 20, tx)).length, 0,
          "stock-card part filter does not mix another sparepart's ledger");
        throw new Error(rollbackMessage);
      });
    } catch (error) {
      assert.equal((error as Error).message, rollbackMessage, "fixture transaction is rolled back after assertions");
    }

    assert.equal(await prisma.stockMovement.count({ where: { sourceType: "INTEGRATION_TEST", sourceId: { startsWith: sourceId } } }), 0,
      "rolled-back stock tests leave no permanent ledger rows");
    assert.equal(partId === undefined ? 0 : await prisma.sparePart.count({ where: { id: partId } }), 0,
      "rolled-back stock test leaves no sparepart fixture");
  } finally {
    await prisma.user.delete({ where: { id: admin.id } });
  }
});
