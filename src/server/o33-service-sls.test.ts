import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement } from "@/server/stock-service";
import { parseWorkshopDateTime } from "@/server/datetime";
import { cancelService, createService, updateCompletedService } from "@/server/service-service";
import { cancelSls, createSls, updateCompletedSls } from "@/server/sls-service";

test("O3.3 Service revision lineage edit and cancel are atomic and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_o33_service_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`O33-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username };
  let serviceId: bigint | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const part = await tx.sparePart.create({ data: { code: `O33S${sequence!.value}`, name: `O33 Service ${suffix}`, sellingPrice: 3000n, latestBuyPrice: 2500n } });
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 10n, unitCost: 1000n, sourceType: "TEST", sourceId: suffix, actorId: user.id });
      const original = { transactionAt: parseWorkshopDateTime("2026-10-01T10:00"), vehicleDescription: "Test", discount: 0n, jobs: [{ description: "Job", amount: 1000n }], items: [{ sparePartId: part.id, quantity: 5n, sellingPrice: 3000n }] };
      const created = await createService(original, actor, `o33-service-create-${suffix}`, "ADMIN", tx); serviceId = BigInt(created.id);
      assert.equal(await tx.serviceRevision.count({ where: { serviceId: serviceId } }), 1);
      await updateCompletedService(serviceId, { ...original, items: [{ ...original.items[0]!, quantity: 3n }], reason: "Koreksi pemakaian" }, actor, `o33-service-edit-${suffix}`, tx);
      assert.equal((await tx.service.findUniqueOrThrow({ where: { id: serviceId } })).editCount, 1);
      assert.equal(await tx.serviceRevision.count({ where: { serviceId } }), 2);
      const movements = await tx.stockMovement.findMany({ where: { sourceType: "SERVICE", sourceId: serviceId.toString() }, orderBy: { id: "asc" } });
      assert.deepEqual(movements.map((movement) => movement.quantity), [-5n, 2n]);
      assert.equal((await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } })).stockOnHand, 7n);
      await assert.rejects(updateCompletedService(serviceId, { ...original, reason: "second" }, actor, `o33-service-edit-2-${suffix}`, tx), /satu kali/i);
      const canceled = await cancelService(serviceId, "Pekerjaan dibatalkan", actor, `o33-service-cancel-${suffix}`, tx);
      assert.equal(canceled.status, "CANCELED");
      assert.deepEqual((await tx.stockMovement.findMany({ where: { sourceType: "SERVICE", sourceId: serviceId.toString() }, orderBy: { id: "asc" } })).map((movement) => movement.quantity), [-5n, 2n, 3n]);
      assert.equal((await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } })).stockOnHand, 10n);
      await assert.rejects(cancelService(serviceId, "lagi", actor, `o33-service-cancel-2-${suffix}`, tx), /dibatalkan|tidak dapat/i);
      await assert.rejects(cancelService(serviceId, "   ", actor, `o33-service-cancel-blank-${suffix}`, tx), /wajib/i);
      const replay = await cancelService(serviceId, "Pekerjaan dibatalkan", actor, `o33-service-cancel-${suffix}`, tx); assert.equal(replay.id, serviceId.toString());
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.delete({ where: { id: user.id } });
});

test("O3.3 SLS revision lineage edit and cancel use stored HPP and required reason", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_o33_sls_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`O33-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username };
  try {
    await prisma.$transaction(async (tx) => {
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const part = await tx.sparePart.create({ data: { code: `O33L${sequence!.value}`, name: `O33 SLS ${suffix}`, sellingPrice: 3000n, latestBuyPrice: 2500n } });
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 10n, unitCost: 1100n, sourceType: "TEST", sourceId: suffix, actorId: user.id });
      const original = { transactionAt: parseWorkshopDateTime("2026-10-01T10:00"), discount: 0n, items: [{ sparePartId: part.id, quantity: 5n, sellingPrice: 3000n }] };
      const created = await createSls(original, actor, `o33-sls-create-${suffix}`, "ADMIN", tx); const id = BigInt(created.id);
      await assert.rejects(updateCompletedSls(id, { ...original, reason: "   " }, actor, `o33-sls-blank-${suffix}`, tx), /wajib/i);
      await updateCompletedSls(id, { ...original, items: [{ ...original.items[0]!, quantity: 3n }], reason: "Koreksi penjualan" }, actor, `o33-sls-edit-${suffix}`, tx);
      const canceled = await cancelSls(id, "Penjualan dibatalkan", actor, `o33-sls-cancel-${suffix}`, tx);
      assert.equal(canceled.status, "CANCELED");
      assert.equal((await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } })).stockOnHand, 10n);
      const revisions = await tx.slsRevision.findMany({ where: { slsId: id }, orderBy: { revisionNumber: "asc" }, include: { items: true } });
      assert.deepEqual(revisions.map((revision) => revision.revisionNumber), [0, 1]);
      assert.equal(revisions[0]!.items[0]!.unitHppSnapshot, 1100n);
      assert.equal(revisions[1]!.items[0]!.unitHppSnapshot, 1100n);
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.delete({ where: { id: user.id } });
});
