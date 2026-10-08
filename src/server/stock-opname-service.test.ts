import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement } from "@/server/stock-service";
import { parseWorkshopDateTime } from "@/server/datetime";
import { approveStockOpname, createStockOpname, finalizeStockOpname, rejectStockOpname, recheckStockOpname } from "@/server/stock-opname-service";

test("S4.1 captures all parts, supports partial recheck, and finalizes without stock effects", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_s41_${suffix}`, role: "USER", passwordHash: await hashPassword(`S41-${suffix}-Password!`) } });
  const admin = await prisma.user.create({ data: { username: `it_s41_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`S41-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username }; const adminActor = { id: admin.id, username: admin.username };
  try {
    await prisma.$transaction(async (tx) => {
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const active = await tx.sparePart.create({ data: { code: `S41A${sequence!.value}`, name: `S41 Active ${suffix}`, sellingPrice: 1000n } });
      const inactive = await tx.sparePart.create({ data: { code: `S41I${sequence!.value}`, name: `S41 Inactive ${suffix}`, sellingPrice: 1000n, isActive: false } });
      const deleted = await tx.sparePart.create({ data: { code: `S41D${sequence!.value}`, name: `S41 Deleted ${suffix}`, sellingPrice: 1000n, isActive: false, deletedAt: new Date() } });
      await applyStockMovement(tx, { sparePartId: active.id, movementType: "OPENING_STOCK", quantity: 5n, unitCost: 100n, sourceType: "TEST", sourceId: suffix, actorId: user.id });
      const beforeActive = await tx.sparePart.findUniqueOrThrow({ where: { id: active.id } });
      const beforeInactive = await tx.sparePart.findUniqueOrThrow({ where: { id: inactive.id } });
      const partCountBeforeOpname = await tx.sparePart.count({ where: { deletedAt: null } });
      const created = await createStockOpname({ transactionAt: parseWorkshopDateTime("2026-10-01T10:00") }, actor, `s41-create-${suffix}`, "USER", tx);
      assert.equal(created.status, "REVISION");
      assert.equal(created.items.length, partCountBeforeOpname);
      assert.ok(created.items.some((item) => item.sparePartId === active.id.toString()));
      assert.ok(created.items.some((item) => item.sparePartId === inactive.id.toString()));
      assert.equal(created.items.some((item) => item.sparePartId === deleted.id.toString()), false);
      const newPart = await tx.sparePart.create({ data: { code: `S41N${sequence!.value}`, name: `S41 New ${suffix}`, sellingPrice: 1000n } });
      await tx.sparePart.update({ where: { id: active.id }, data: { isActive: false, deletedAt: new Date() } });
      const partial = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T11:00"), items: [{ sparePartId: active.id, physicalStock: 0n }] }, actor, `s41-recheck-${suffix}`, "USER", tx);
      assert.equal(partial.items.find((item) => item.sparePartId === active.id.toString())!.difference, "-5");
      assert.equal(partial.items.find((item) => item.sparePartId === inactive.id.toString())!.physicalStock, null);
      assert.ok(partial.items.some((item) => item.sparePartId === active.id.toString()), "historical item remains after its sparepart is removed from the list");
      assert.equal(partial.items.some((item) => item.sparePartId === newPart.id.toString()), false);
      const auditsBeforeNoop = await tx.auditLog.count({ where: { objectType: "STOCK_OPNAME", objectId: created.id } });
      await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T11:00"), items: [{ sparePartId: active.id, physicalStock: 0n }] }, actor, `s41-noop-${suffix}`, "USER", tx);
      assert.equal(await tx.auditLog.count({ where: { objectType: "STOCK_OPNAME", objectId: created.id } }), auditsBeforeNoop);
      await assert.rejects(finalizeStockOpname(BigInt(created.id), adminActor, `s41-finalize-incomplete-${suffix}`, "ADMIN", tx), /semua physical stock/i);
      const finalized = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T11:00"), items: created.items.map((item) => ({ sparePartId: BigInt(item.sparePartId), physicalStock: item.sparePartId === active.id.toString() ? 0n : 0n })) }, actor, `s41-recheck-complete-${suffix}`, "USER", tx);
      const done = await finalizeStockOpname(BigInt(finalized.id), adminActor, `s41-finalize-${suffix}`, "ADMIN", tx);
      assert.equal(done.status, "FINALIZED"); assert.equal(done.opnameNumber, created.opnameNumber);
      const afterActive = await tx.sparePart.findUniqueOrThrow({ where: { id: active.id } }); const afterInactive = await tx.sparePart.findUniqueOrThrow({ where: { id: inactive.id } });
      assert.equal(afterActive.stockOnHand, beforeActive.stockOnHand); assert.equal(afterActive.stockVersion, beforeActive.stockVersion); assert.equal(afterInactive.stockVersion, beforeInactive.stockVersion);
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "STOCK_OPNAME", sourceId: created.id } }), 0);
      const afterFinalizeRecheck = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T12:00"), items: [{ sparePartId: active.id, physicalStock: 1n }] }, actor, `s41-after-finalize-${suffix}`, "USER", tx);
      assert.equal(afterFinalizeRecheck.status, "FINALIZED");
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
});

test("S4.2 approves against verified stock, records lineage, and rejects without stock effect", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_s42_${suffix}`, role: "USER", passwordHash: await hashPassword(`S42-${suffix}-Password!`) } });
  const admin = await prisma.user.create({ data: { username: `it_s42_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`S42-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username }; const adminActor = { id: admin.id, username: admin.username };
  try {
    await prisma.$transaction(async (tx) => {
      const part = await tx.sparePart.create({ data: { code: `S42${suffix}`, name: `S42 Part ${suffix}`, sellingPrice: 1000n } });
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 10n, unitCost: 50000n, sourceType: "TEST", sourceId: suffix, actorId: admin.id });
      const created = await createStockOpname({ transactionAt: parseWorkshopDateTime("2026-10-01T10:00") }, actor, `s42-create-${suffix}`, "USER", tx);
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "PURCHASE_RECEIPT", quantity: 2n, unitCost: 50000n, sourceType: "TEST", sourceId: `${suffix}-change`, actorId: admin.id });
      const recounted = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T11:00"), items: created.items.map((item) => ({ sparePartId: BigInt(item.sparePartId), physicalStock: item.sparePartId === part.id.toString() ? 8n : BigInt(item.systemStock) })) }, actor, `s42-recheck-${suffix}`, "ADMIN", tx);
      const recountedPart = recounted.items.find((item) => item.sparePartId === part.id.toString())!;
      assert.equal(recountedPart.systemStock, "10");
      assert.equal(recountedPart.verifiedSystemStock, "12");
      assert.equal(recountedPart.difference, "-4");
      await finalizeStockOpname(BigInt(created.id), adminActor, `s42-finalize-${suffix}`, "ADMIN", tx);
      const approved = await approveStockOpname(BigInt(created.id), adminActor, `s42-approve-${suffix}`, tx);
      assert.equal(approved.stockOpname.status, "APPROVED");
      assert.equal(approved.adjustmentSummary.find((item) => item.sparePartId === part.id.toString())!.difference, "-4");
      assert.ok(approved.approvalOperationId);
      const after = await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } });
      assert.equal(after.stockOnHand, 8n);
      assert.equal(after.averageCost, 50000n);
      const movement = await tx.stockMovement.findFirstOrThrow({ where: { sourceType: "STOCK_OPNAME", sourceId: created.id } });
      assert.equal(movement.sourceRevision, recounted.revisionNumber);
      assert.equal(movement.sourceOperation, approved.approvalOperationId);
      assert.equal(movement.movementType, "ADJUSTMENT_OUT");
      const replay = await approveStockOpname(BigInt(created.id), adminActor, `s42-approve-${suffix}`, tx);
      assert.equal(replay.approvalOperationId, approved.approvalOperationId);
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "STOCK_OPNAME", sourceId: created.id } }), 1);
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
});

test("S4.2 zero adjustment approves without movement and reject keeps stock unchanged", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_s42z_${suffix}`, role: "USER", passwordHash: await hashPassword(`S42Z-${suffix}-Password!`) } });
  const admin = await prisma.user.create({ data: { username: `it_s42z_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`S42Z-${suffix}-Password!`) } });
  try {
    await prisma.$transaction(async (tx) => {
      const part = await tx.sparePart.create({ data: { code: `S42Z${suffix}`, name: `S42 Zero ${suffix}`, sellingPrice: 1000n } });
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 5n, unitCost: 70000n, sourceType: "TEST", sourceId: suffix, actorId: admin.id });
      const created = await createStockOpname({ transactionAt: parseWorkshopDateTime("2026-10-01T10:00") }, { id: user.id, username: user.username }, `s42z-create-${suffix}`, "USER", tx);
      const afterRecheck = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T10:01"), items: (await tx.stockOpnameItem.findMany({ where: { stockOpnameId: BigInt(created.id) } })).map((item) => ({ sparePartId: item.sparePartId, physicalStock: item.sparePartId === part.id ? 5n : item.systemStock })) }, { id: user.id, username: user.username }, `s42z-recheck-${suffix}`, "USER", tx);
      assert.equal(afterRecheck.items.find((item) => item.sparePartId === part.id.toString())!.physicalStock, "5");
      await finalizeStockOpname(BigInt(created.id), { id: admin.id, username: admin.username }, `s42z-finalize-${suffix}`, "ADMIN", tx);
      const rejected = await rejectStockOpname(BigInt(created.id), "Perlu verifikasi ulang", { id: admin.id, username: admin.username }, `s42z-reject-${suffix}`, tx);
      assert.equal(rejected.stockOpname.status, "REVISION");
      await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T10:02"), items: (await tx.stockOpnameItem.findMany({ where: { stockOpnameId: BigInt(created.id) } })).map((item) => ({ sparePartId: item.sparePartId, physicalStock: item.systemStock })) }, { id: user.id, username: user.username }, `s42z-recheck-again-${suffix}`, "USER", tx);
      await finalizeStockOpname(BigInt(created.id), { id: admin.id, username: admin.username }, `s42z-finalize-again-${suffix}`, "ADMIN", tx);
      const approved = await approveStockOpname(BigInt(created.id), { id: admin.id, username: admin.username }, `s42z-approve-${suffix}`, tx);
      assert.equal(approved.adjustmentSummary[0]!.difference, "0");
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "STOCK_OPNAME", sourceId: created.id } }), 0);
      assert.equal((await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } })).stockVersion, 1n);
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
});
