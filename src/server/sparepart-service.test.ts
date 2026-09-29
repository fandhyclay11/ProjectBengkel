import "dotenv/config";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { createSparePart, deleteSparePart, listSpareParts, SparePartServiceError, updateSparePart } from "@/server/sparepart-service";

test("sparepart master preserves identity, role-safe fields, and idempotent changes", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for database integration tests");
    return;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const admin = await prisma.user.create({
    data: { username: `it_part_admin_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`Integration-${suffix}-Password!`) },
  });
  const actor = { id: admin.id, username: admin.username };
  const codePrefix = "SP";
  try {
    const payload = { name: `Brake Pad Integration ${suffix}`, sellingPrice: 34500n, minimumStock: 2n };
    const key = `create-${suffix}`;
    const created = await createSparePart(payload, actor, key);
    const replayed = await createSparePart(payload, actor, key);
    assert.equal(replayed.id.toString(), created.id.toString(), "same actor/key/payload returns the original outcome");
    assert.equal(await prisma.idempotencyRecord.count({ where: { actorId: admin.id, operation: "sparepart.create", requestKey: key } }), 1);

    const concurrentPayload = { ...payload, name: `Oil Filter Integration ${suffix}` };
    const concurrentKey = `concurrent-${suffix}`;
    const [concurrentA, concurrentB] = await Promise.all([
      createSparePart(concurrentPayload, actor, concurrentKey),
      createSparePart(concurrentPayload, actor, concurrentKey),
    ]);
    assert.equal(concurrentA.id.toString(), concurrentB.id.toString(), "concurrent replay with the same key must create one outcome");

    await assert.rejects(
      createSparePart({ ...payload, sellingPrice: 999n }, actor, key),
      (error: unknown) => error instanceof SparePartServiceError && error.kind === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      createSparePart({ ...payload, name: `  BRAKE PAD INTEGRATION ${suffix} ` }, actor, `duplicate-${suffix}`),
      (error: unknown) => error instanceof SparePartServiceError && error.kind === "DUPLICATE_NAME",
    );
    await assert.rejects(
      createSparePart({ ...payload, name: `Brake Pads Integration ${suffix}` }, actor, `similar-${suffix}`),
      (error: unknown) => error instanceof SparePartServiceError && error.kind === "SIMILAR_NAME" && error.similarParts.some((part) => part.code === created.code),
    );

    const similar = await createSparePart({ ...payload, name: `Brake Pads Integration ${suffix}` }, actor, `similar-confirmed-${suffix}`, true);
    assert.ok(similar.code !== created.code, "generated codes are never reused");
    const updated = await updateSparePart(created.id, { sellingPrice: 36000n, minimumStock: 3n }, actor, `update-${suffix}`);
    assert.equal(updated.sellingPrice, 36000n);

    const adminParts = await listSpareParts("ADMIN");
    assert.ok(adminParts.some((part) => part.code === created.code && "sellingPrice" in part));
    const userParts = await listSpareParts("USER");
    const userPart = userParts.find((part) => part.code === created.code);
    assert.ok(userPart);
    assert.equal("sellingPrice" in userPart, false);
    assert.equal("latestBuyPrice" in userPart, false);
    assert.equal("averageCost" in userPart, false);

    await updateSparePart(created.id, { isActive: false }, actor, `deactivate-${suffix}`);
    assert.equal((await listSpareParts("USER")).some((part) => part.code === created.code), false,
      "inactive spareparts are not included in the USER list");
    await updateSparePart(created.id, { isActive: true }, actor, `reactivate-${suffix}`);

    const deleteKey = `delete-${suffix}`;
    await deleteSparePart(created.id, actor, deleteKey);
    await deleteSparePart(created.id, actor, deleteKey);
    assert.equal(await prisma.sparePart.findUnique({ where: { id: created.id } }).then((part) => part?.code), created.code,
      "removing from active list retains the master identity and generated code");
    assert.ok(await prisma.sparePart.findUnique({ where: { id: created.id } }).then((part) => part?.deletedAt));
    assert.equal((await listSpareParts("USER")).some((part) => part.code === created.code), false);
    const laterPart = await createSparePart({ ...payload, name: `Filter Unit Integration ${suffix}` }, actor, `after-delete-${suffix}`);
    assert.notEqual(laterPart.code, created.code, "a deleted part's generated code is never reused");
    assert.ok(created.code.startsWith(codePrefix));
  } finally {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: admin.id } });
    const parts = await prisma.sparePart.findMany({ where: { code: { startsWith: codePrefix }, name: { contains: suffix } }, select: { id: true } });
    const ids = parts.map((part) => part.id.toString());
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id, objectId: { in: ids } } });
    await prisma.sparePart.deleteMany({ where: { id: { in: parts.map((part) => part.id) } } });
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
    await prisma.auditDeletionTrace.deleteMany({ where: { actorId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  }
});
