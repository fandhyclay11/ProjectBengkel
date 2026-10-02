import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { cancelExpense, createExpense, updateExpense } from "@/server/expense-service";
import { parseWorkshopDateTime } from "@/server/datetime";

test("O3.4 Expense lifecycle is idempotent, unlimited-editable, audited, and has no stock movement", async (t) => {
  if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({ data: { username: `it_o34_${suffix}`, role: "ADMIN", passwordHash: await hashPassword(`O34-${suffix}-Password!`) } });
  const actor = { id: user.id, username: user.username };
  try {
    await prisma.$transaction(async (tx) => {
      const input = { transactionAt: parseWorkshopDateTime("2026-10-02T10:00"), items: [{ description: "Listrik", quantity: "1.250", unitPrice: "100" }], generalNote: "awal", externalReceiptNumber: "R-1" };
      const created = await createExpense(input, actor, `o34-create-${suffix}`, tx);
      const replay = await createExpense(input, actor, `o34-create-${suffix}`, tx);
      assert.equal(replay.id, created.id);
      const edited = await updateExpense(BigInt(created.id), { ...input, transactionAt: parseWorkshopDateTime("2026-10-02T11:00"), items: [{ description: "Listrik", quantity: "2.000", unitPrice: "100" }] }, actor, `o34-edit-${suffix}`, tx);
      assert.equal(edited.expenseNumber, created.expenseNumber);
      const noteOnly = await updateExpense(BigInt(created.id), { transactionAt: parseWorkshopDateTime("2026-10-02T11:00"), items: [{ description: "Listrik", quantity: "2.000", unitPrice: "100" }], generalNote: "ubah note", externalReceiptNumber: "R-1" }, actor, `o34-note-${suffix}`, tx);
      assert.equal(noteOnly.expenseNumber, created.expenseNumber);
      const canceled = await cancelExpense(BigInt(created.id), actor, `o34-cancel-${suffix}`, tx);
      assert.equal(canceled.status, "CANCELED");
      assert.equal(await tx.stockMovement.count({ where: { sourceType: "EXPENSE", sourceId: created.id } }), 0);
      assert.equal(await tx.auditLog.count({ where: { objectType: "EXPENSE", objectId: created.id } }), 3);
      await assert.rejects(updateExpense(BigInt(created.id), input, actor, `o34-after-cancel-${suffix}`, tx), /tidak dapat diedit/i);
      await assert.rejects(cancelExpense(BigInt(created.id), actor, `o34-cancel-again-${suffix}`, tx), /sudah dibatalkan/i);
      throw new Error(`ROLLBACK_${suffix}`);
    });
  } catch (error) { assert.equal((error as Error).message, `ROLLBACK_${suffix}`); }
  await prisma.user.delete({ where: { id: user.id } });
});
