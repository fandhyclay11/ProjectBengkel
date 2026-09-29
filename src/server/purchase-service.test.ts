import "dotenv/config";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { parseWorkshopDateTime } from "@/server/datetime";
import { applyStockMovement } from "@/server/stock-service";
import { cancelPurchase, confirmPurchase, createPurchaseDraft, updateCompletedPurchase, updatePurchaseDraft } from "@/server/purchase-service";

test("Purchase Draft is inert and Confirm atomically receives stock, cost and latest buy price", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for database integration tests");
    return;
  }
  process.env.APP_WORKSHOP_TIMEZONE = "Asia/Jakarta";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const admin = await prisma.user.create({
    data: { username: `it_purchase_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`Integration-${suffix}-Password!`) },
  });
  const actor = { id: admin.id, username: admin.username };
  const sourcePrefix = `it-purchase-${suffix}`;
  const rollbackMessage = `ROLLBACK_PURCHASE_FIXTURE_${suffix}`;
  const testPartIds: bigint[] = [];

  try {
    await assert.rejects(createPurchaseDraft({ transactionAt: parseWorkshopDateTime("2026-09-29T10:00"), supplierName: "", items: [] }, actor, `${sourcePrefix}-empty`));

    try {
      await prisma.$transaction(async (tx) => {
        const codes: string[] = [];
        for (const name of [`Purchase Test A ${suffix}`, `Purchase Test B ${suffix}`]) {
          const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
          codes.push(`SP${sequence!.value.toString().padStart(6, "0")}`);
          const part = await tx.sparePart.create({ data: { code: codes[codes.length - 1]!, name, sellingPrice: 2000n, minimumStock: 0n } });
          testPartIds.push(part.id);
        }
        const [partA, partB] = testPartIds;
        await applyStockMovement(tx, { sparePartId: partA!, movementType: "OPENING_STOCK", quantity: 2n, unitCost: 1100n, sourceType: "INTEGRATION_TEST", sourceId: `${sourcePrefix}-opening`, actorId: admin.id });

        const draft = await createPurchaseDraft({
          transactionAt: parseWorkshopDateTime("2026-09-29T10:00"), supplierName: "Supplier Test",
          items: [{ sparePartId: partA!, quantity: 3n, unitBuyPrice: 1300n }],
        }, actor, `${sourcePrefix}-create`, tx);
        const purchaseId = BigInt(draft.id);
        assert.equal(draft.status, "DRAFT");
        assert.equal(draft.purchaseNumber.startsWith("PUR-20260929-"), true, "number uses workshop business date");
        assert.equal(draft.totalAmount, "3900");
        const currentA = await tx.sparePart.findUniqueOrThrow({ where: { id: partA } });
        assert.equal(currentA.stockOnHand, 2n, "Draft has no stock effect");
        assert.equal(currentA.averageCost, 1100n, "Draft has no costing effect");
        assert.equal(currentA.latestBuyPrice, null, "Draft does not update Latest Buy Price");

        const updatedDraft = await updatePurchaseDraft(purchaseId, {
          transactionAt: parseWorkshopDateTime("2026-09-29T11:00"), supplierName: "Supplier Test 2",
          items: [{ sparePartId: partA!, quantity: 3n, unitBuyPrice: 1300n }, { sparePartId: partB!, quantity: 4n, unitBuyPrice: 600n }],
        }, actor, `${sourcePrefix}-update`, tx);
        assert.equal(updatedDraft.purchaseNumber, draft.purchaseNumber, "editing date keeps the original purchase number");
        assert.equal(updatedDraft.items.length, 2);

        const completed = await confirmPurchase(purchaseId, actor, `${sourcePrefix}-confirm`, tx);
        assert.equal(completed.status, "COMPLETED");
        assert.equal(completed.totalAmount, "6300");
        const completedA = await tx.sparePart.findUniqueOrThrow({ where: { id: partA } });
        const completedB = await tx.sparePart.findUniqueOrThrow({ where: { id: partB } });
        assert.equal(completedA.stockOnHand, 5n);
        assert.equal(completedA.averageCost, 1220n, "purchase receipt updates weighted Average Cost");
        assert.equal(completedA.latestBuyPrice, 1300n);
        assert.equal(completedB.stockOnHand, 4n);
        assert.equal(completedB.averageCost, 600n);
        assert.equal(completedB.latestBuyPrice, 600n);
        assert.equal(await tx.stockMovement.count({ where: { sourceType: "PURCHASE", sourceId: purchaseId.toString() } }), 2);

        const replay = await confirmPurchase(purchaseId, actor, `${sourcePrefix}-confirm`, tx);
        assert.equal(replay.id, completed.id, "same idempotency key returns the original completed Purchase");
        assert.equal(await tx.stockMovement.count({ where: { sourceType: "PURCHASE", sourceId: purchaseId.toString() } }), 2,
          "idempotent Confirm creates no duplicate movements");

        const edited = await updateCompletedPurchase(purchaseId, {
          transactionAt: parseWorkshopDateTime("2026-09-29T11:00"), supplierName: "Supplier Test 2",
          reason: "Koreksi jumlah dan harga barang",
          items: [{ sparePartId: partA!, quantity: 5n, unitBuyPrice: 1400n }, { sparePartId: partB!, quantity: 4n, unitBuyPrice: 600n }],
        }, actor, `${sourcePrefix}-edit`, tx);
        assert.equal(edited.status, "COMPLETED");
        assert.equal(edited.editCount, 1);
        assert.equal(edited.totalAmount, "9400");
        const editedA = await tx.sparePart.findUniqueOrThrow({ where: { id: partA } });
        assert.equal(editedA.stockOnHand, 7n, "edit changes stock only by quantity delta");
        assert.equal(editedA.averageCost, 1314n, "edit adjusts valuation by the Purchase value delta and rounds Average Cost");
        assert.equal(editedA.latestBuyPrice, 1400n);
        const purchaseMovementsA = await tx.stockMovement.findMany({ where: { sparePartId: partA, sourceId: purchaseId.toString() }, orderBy: { id: "asc" } });
        assert.equal(purchaseMovementsA[0]?.quantity, 3n, "original Purchase movement remains immutable");
        assert.equal(purchaseMovementsA.at(-1)?.quantity, 2n, "edit appends the quantity delta movement");
        assert.equal(purchaseMovementsA.at(-1)?.valuationDelta, 3098n);
        assert.equal(purchaseMovementsA.at(-1)?.purchaseValueDelta, 3100n, "source Purchase value is preserved separately from rounded inventory valuation change");
        await assert.rejects(updateCompletedPurchase(purchaseId, {
          transactionAt: parseWorkshopDateTime("2026-09-29T11:00"), supplierName: "Supplier Test 2", reason: "Edit kedua",
          items: [{ sparePartId: partA!, quantity: 5n, unitBuyPrice: 1450n }, { sparePartId: partB!, quantity: 4n, unitBuyPrice: 600n }],
        }, actor, `${sourcePrefix}-edit-twice`, tx), /satu kali/i);

        const canceled = await cancelPurchase(purchaseId, actor, `${sourcePrefix}-cancel`, tx);
        assert.equal(canceled.status, "CANCELED");
        const afterCancelA = await tx.sparePart.findUniqueOrThrow({ where: { id: partA } });
        const afterCancelB = await tx.sparePart.findUniqueOrThrow({ where: { id: partB } });
        assert.equal(afterCancelA.stockOnHand, 2n, "cancel reverses the effective Purchase quantity");
        assert.equal(afterCancelA.averageCost, 1100n, "cancel restores the valuation effects of the Purchase while keeping unrelated stock");
        assert.equal(afterCancelA.latestBuyPrice, null, "cancel falls back to the previous valid Purchase price");
        assert.equal(afterCancelB.stockOnHand, 0n);
        assert.equal(afterCancelB.averageCost, null, "zero stock has no Average Cost");

        const priceOnlyDraft = await createPurchaseDraft({
          transactionAt: parseWorkshopDateTime("2026-09-29T11:30"), supplierName: "Supplier Price Only",
          items: [{ sparePartId: partB!, quantity: 2n, unitBuyPrice: 600n }],
        }, actor, `${sourcePrefix}-price-create`, tx);
        await confirmPurchase(BigInt(priceOnlyDraft.id), actor, `${sourcePrefix}-price-confirm`, tx);
        await updateCompletedPurchase(BigInt(priceOnlyDraft.id), {
          transactionAt: parseWorkshopDateTime("2026-09-29T11:30"), supplierName: "Supplier Price Only",
          reason: "Koreksi harga beli",
          items: [{ sparePartId: partB!, quantity: 2n, unitBuyPrice: 700n }],
        }, actor, `${sourcePrefix}-price-edit`, tx);
        const priceCorrection = await tx.stockMovement.findFirstOrThrow({ where: { sourceType: "PURCHASE_EDIT", sourceId: priceOnlyDraft.id } });
        assert.equal(priceCorrection.quantity, 0n, "price-only edit records a zero-quantity stock correction");
        assert.equal(priceCorrection.purchaseValueDelta, 200n);
        assert.equal(priceCorrection.valuationDelta, 200n);
        await cancelPurchase(BigInt(priceOnlyDraft.id), actor, `${sourcePrefix}-price-cancel`, tx);
        const afterPriceOnlyCancel = await tx.sparePart.findUniqueOrThrow({ where: { id: partB } });
        assert.equal(afterPriceOnlyCancel.stockOnHand, 0n);
        assert.equal(afterPriceOnlyCancel.averageCost, null);

        const guardedDraft = await createPurchaseDraft({
          transactionAt: parseWorkshopDateTime("2026-09-29T12:00"), supplierName: "Supplier Guard",
          items: [{ sparePartId: partA!, quantity: 2n, unitBuyPrice: 2000n }],
        }, actor, `${sourcePrefix}-guard-create`, tx);
        await confirmPurchase(BigInt(guardedDraft.id), actor, `${sourcePrefix}-guard-confirm`, tx);
        await applyStockMovement(tx, {
          sparePartId: partA!, movementType: "SERVICE_ISSUE", quantity: -1n, sourceType: "INTEGRATION_TEST",
          sourceId: `${sourcePrefix}-later-issue`, actorId: admin.id,
        });
        await applyStockMovement(tx, {
          sparePartId: partA!, movementType: "PURCHASE_RECEIPT", quantity: 1n, unitCost: 2100n,
          sourceType: "INTEGRATION_TEST", sourceId: `${sourcePrefix}-later-receipt`, actorId: admin.id,
        });
        await assert.rejects(cancelPurchase(BigInt(guardedDraft.id), actor, `${sourcePrefix}-guard-cancel`, tx), /pengeluaran stok setelah Confirm/i);
        const supplierOnly = await updateCompletedPurchase(BigInt(guardedDraft.id), {
          transactionAt: parseWorkshopDateTime("2026-09-29T12:00"), supplierName: "Supplier Guard Updated",
          items: [{ sparePartId: partA!, quantity: 2n, unitBuyPrice: 2000n }],
        }, actor, `${sourcePrefix}-guard-supplier`, tx);
        assert.equal(supplierOnly.supplierName, "Supplier Guard Updated", "supplier-only edit remains allowed after stock use and needs no reason");
        throw new Error(rollbackMessage);
      });
    } catch (error) {
      assert.equal((error as Error).message, rollbackMessage, "test-only business transactions roll back all persistent fixtures");
    }
    assert.equal(await prisma.purchase.count({ where: { purchaseNumber: { startsWith: "PUR-20260929-" } } }), 0,
      "rolled-back Purchase test leaves no permanent transactions");
    assert.equal(await prisma.stockMovement.count({ where: { sourceType: "PURCHASE", sourceId: { startsWith: sourcePrefix } } }), 0,
      "rolled-back Purchase test leaves no permanent movements");
    assert.equal(await prisma.sparePart.count({ where: { id: { in: testPartIds } } }), 0,
      "rolled-back Purchase test leaves no sparepart fixtures");
  } finally {
    await prisma.user.delete({ where: { id: admin.id } });
  }
});
