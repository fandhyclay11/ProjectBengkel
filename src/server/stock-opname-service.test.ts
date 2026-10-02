import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement } from "@/server/stock-service";
import { parseWorkshopDateTime } from "@/server/datetime";
import { createStockOpname, finalizeStockOpname, recheckStockOpname } from "@/server/stock-opname-service";

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
      const inactive = await tx.sparePart.create({ data: { code: `S41I${sequence!.value}`, name: `S41 Inactive ${suffix}`, sellingPrice: 1000n, isActive: false, deletedAt: new Date() } });
      await applyStockMovement(tx, { sparePartId: active.id, movementType: "OPENING_STOCK", quantity: 5n, unitCost: 100n, sourceType: "TEST", sourceId: suffix, actorId: user.id });
      const beforeActive = await tx.sparePart.findUniqueOrThrow({ where: { id: active.id } });
      const beforeInactive = await tx.sparePart.findUniqueOrThrow({ where: { id: inactive.id } });
      const partCountBeforeOpname = await tx.sparePart.count();
      const created = await createStockOpname({ transactionAt: parseWorkshopDateTime("2026-10-01T10:00") }, actor, `s41-create-${suffix}`, "USER", tx);
      assert.equal(created.status, "REVISION");
      assert.equal(created.items.length, partCountBeforeOpname);
      assert.ok(created.items.some((item) => item.sparePartId === active.id.toString()));
      assert.ok(created.items.some((item) => item.sparePartId === inactive.id.toString()));
      const newPart = await tx.sparePart.create({ data: { code: `S41N${sequence!.value}`, name: `S41 New ${suffix}`, sellingPrice: 1000n } });
      const partial = await recheckStockOpname(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-01T11:00"), items: [{ sparePartId: active.id, physicalStock: 0n }] }, actor, `s41-recheck-${suffix}`, "USER", tx);
      assert.equal(partial.items.find((item) => item.sparePartId === active.id.toString())!.difference, "-5");
      assert.equal(partial.items.find((item) => item.sparePartId === inactive.id.toString())!.physicalStock, null);
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
