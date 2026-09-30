import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement } from "@/server/stock-service";
import { createService, previewService } from "@/server/service-service";
import { parseWorkshopDateTime } from "@/server/datetime";

test("Service preview and final save are transient, atomic, costed and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  process.env.APP_WORKSHOP_TIMEZONE = "Asia/Jakarta";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const passwordHash = await hashPassword(`Service-${suffix}-Password!`);
  const user = await prisma.user.create({ data: { username: `it_service_${suffix}`, role: "USER", passwordHash } });
  const actor = { id: user.id, username: user.username };
  const key = `service-test-${suffix}`;
  const rollback = `ROLLBACK_SERVICE_${suffix}`;
  let partId: bigint | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const part = await tx.sparePart.create({ data: { code: `SP${sequence!.value.toString().padStart(6, "0")}`, name: `Service Test ${suffix}`, sellingPrice: 2500n, latestBuyPrice: 2200n, minimumStock: 0n } });
      partId = part.id;
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 5n, unitCost: 1200n, sourceType: "INTEGRATION_TEST", sourceId: `service-opening-${suffix}`, actorId: user.id });
      const input = { transactionAt: parseWorkshopDateTime("2026-09-30T10:15"), vehicleDescription: "Honda Test", discount: 500n, jobs: [{ description: "Tune up", amount: 10000n }, { description: "Cek rem", amount: 5000n }], items: [{ sparePartId: part.id, quantity: 2n, sellingPrice: 2000n }] };
      const preview = await previewService(input, "USER", tx);
      assert.equal(preview.totalAmount, "18500");
      assert.equal("totalHpp" in preview, false);
      assert.equal(await tx.service.count(), 0);
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "SERVICE" } }), 0);
      const created = await createService(input, actor, key, "USER", tx);
      assert.equal(created.status, "COMPLETED");
      assert.match(created.serviceNumber, /^SRV-20260930-\d{4}$/);
      assert.equal(created.totalAmount, "18500");
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "SERVICE", sourceId: created.id } }), 1);
      const partAfter = await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } });
      assert.equal(partAfter.stockOnHand, 3n);
      assert.equal(partAfter.averageCost, 1200n);
      const replay = await createService(input, actor, key, "USER", tx);
      assert.equal(replay.id, created.id);
      assert.equal(await tx.service.count(), 1);
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "SERVICE", sourceId: created.id } }), 1);
      await assert.rejects(createService({ ...input, items: [{ ...input.items[0]!, quantity: 9n }] }, actor, key, "USER", tx), /data yang berbeda/i);
      await assert.rejects(createService({ ...input, jobs: [] }, actor, `empty-${suffix}`, "USER", tx), /minimal satu/i);
      await assert.rejects(createService({ ...input, items: [input.items[0]!, { ...input.items[0]! }] }, actor, `duplicate-${suffix}`, "USER", tx), /tidak boleh muncul/i);
      await assert.rejects(createService({ ...input, items: [{ ...input.items[0]!, quantity: 10n }] }, actor, `short-${suffix}`, "USER", tx), /Stok tidak mencukupi/i);
      throw new Error(rollback);
    });
  } catch (error) { assert.equal((error as Error).message, rollback); }
  assert.equal(await prisma.service.count({ where: { serviceNumber: { startsWith: "SRV-20260930-" } } }), 0);
  if (partId !== undefined) assert.equal(await prisma.sparePart.count({ where: { id: partId } }), 0);
  await prisma.user.delete({ where: { id: user.id } });
});
