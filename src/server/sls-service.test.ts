import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { applyStockMovement } from "@/server/stock-service";
import { createSls, previewSls } from "@/server/sls-service";
import { parseWorkshopDateTime } from "@/server/datetime";

test("SLS preview and final save are transient, atomic, costed and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  process.env.APP_WORKSHOP_TIMEZONE = "Asia/Jakarta";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const user = await prisma.user.create({ data: { username: `it_sls_${suffix}`, role: "USER", passwordHash: await hashPassword(`Sls-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username };
  const rollback = `ROLLBACK_SLS_${suffix}`;
  let partId: bigint | undefined;
  let createdSlsNumber: string | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const part = await tx.sparePart.create({ data: { code: `SP${sequence!.value.toString().padStart(6, "0")}`, name: `SLS Test ${suffix}`, sellingPrice: 2500n, latestBuyPrice: 2200n, minimumStock: 0n } });
      partId = part.id;
      await applyStockMovement(tx, { sparePartId: part.id, movementType: "OPENING_STOCK", quantity: 5n, unitCost: 1200n, sourceType: "INTEGRATION_TEST", sourceId: `sls-opening-${suffix}`, actorId: user.id });
      const input = { transactionAt: parseWorkshopDateTime("2026-09-30T10:15"), discount: 500n, items: [{ sparePartId: part.id, quantity: 2n, sellingPrice: 2000n }] };
      const preview = await previewSls(input, "USER", tx);
      assert.equal(preview.subtotal, "4000"); assert.equal(preview.totalAmount, "3500"); assert.equal("totalHpp" in preview, false);
      assert.equal(await tx.sls.count({ where: { createdById: user.id } }), 0); assert.equal(await tx.stockMovement.count({ where: { sourceType: "SLS", actorId: user.id } }), 0);
      const created = await createSls(input, actor, `sls-${suffix}`, "USER", tx);
      createdSlsNumber = created.slsNumber;
      assert.equal(created.status, "COMPLETED"); assert.match(created.slsNumber, /^SLS-20260930-\d{4}$/); assert.equal(created.totalAmount, "3500"); assert.equal("totalHpp" in created, false);
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "SLS", sourceId: created.id } }), 1);
      const after = await tx.sparePart.findUniqueOrThrow({ where: { id: part.id } }); assert.equal(after.stockOnHand, 3n); assert.equal(after.averageCost, 1200n);
      const replay = await createSls(input, actor, `sls-${suffix}`, "USER", tx); assert.equal(replay.id, created.id); assert.equal(await tx.sls.count({ where: { createdById: user.id } }), 1); assert.equal(await tx.stockMovement.count({ where: { sourceType: "SLS", sourceId: created.id } }), 1);
      await assert.rejects(createSls({ ...input, items: [{ ...input.items[0]!, quantity: 9n }] }, actor, `sls-${suffix}`, "USER", tx), /data yang berbeda/i);
      await assert.rejects(createSls({ ...input, items: [] }, actor, `empty-${suffix}`, "USER", tx), /minimal satu/i);
      await assert.rejects(createSls({ ...input, items: [input.items[0]!, { ...input.items[0]! }] }, actor, `duplicate-${suffix}`, "USER", tx), /tidak boleh muncul/i);
      await assert.rejects(createSls({ ...input, items: [{ ...input.items[0]!, quantity: 10n }] }, actor, `short-${suffix}`, "USER", tx), /Stok tidak mencukupi/i);
      throw new Error(rollback);
    });
  } catch (error) { assert.equal((error as Error).message, rollback); }
  assert.ok(createdSlsNumber);
  assert.equal(await prisma.sls.count({ where: { slsNumber: createdSlsNumber } }), 0);
  if (partId !== undefined) assert.equal(await prisma.sparePart.count({ where: { id: partId } }), 0);
  await prisma.user.delete({ where: { id: user.id } });
});
