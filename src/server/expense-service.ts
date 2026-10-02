import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";
import { calculateExpense, ExpenseCalculationError } from "@/server/expense-calculation";

type Actor = { id: bigint; username: string };
export type ExpenseInput = { transactionAt: Date; items: Array<{ description: string; quantity: string; unitPrice: string }>; generalNote?: string; externalReceiptNumber?: string };
export class ExpenseServiceError extends Error { constructor(readonly kind: "NOT_FOUND" | "INVALID" | "FUTURE_DATE" | "STATE_CONFLICT" | "IDEMPOTENCY_CONFLICT", message: string) { super(message); } }

function validate(input: ExpenseInput) {
  if (!Number.isFinite(input.transactionAt.getTime())) throw new ExpenseServiceError("INVALID", "Tanggal Expense tidak valid.");
  if (input.transactionAt.getTime() > Date.now()) throw new ExpenseServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
  if ((input.generalNote?.length ?? 0) > 1000 || (input.externalReceiptNumber?.length ?? 0) > 100) throw new ExpenseServiceError("INVALID", "Catatan Expense terlalu panjang.");
  try { calculateExpense(input.items); } catch (error) { if (error instanceof ExpenseCalculationError) throw new ExpenseServiceError("INVALID", error.message); throw error; }
}

function mapExpense(row: { id: bigint; expenseNumber: string; transactionAt: Date; status: string; createdById: bigint; totalAmount: bigint; generalNote: string | null; externalReceiptNumber: string | null; createdAt: Date; updatedAt: Date; items: Array<{ lineNumber: number; description: string; quantity: Prisma.Decimal; unitPrice: bigint; lineAmount: bigint }> }) {
  return { id: row.id.toString(), expenseNumber: row.expenseNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), status: row.status as "COMPLETED" | "CANCELED", createdById: row.createdById.toString(), totalAmount: row.totalAmount.toString(), generalNote: row.generalNote, externalReceiptNumber: row.externalReceiptNumber, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ lineNumber: item.lineNumber, description: item.description, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), lineAmount: item.lineAmount.toString() })) };
}

const include = { items: true } as const;
function auditValues(row: Parameters<typeof mapExpense>[0]) { return mapExpense(row); }
async function nextNumber(tx: Prisma.TransactionClient, date: Date) {
  const dateKey = workshopDateKey(date);
  const [row] = await tx.$queryRaw<Array<{ last_number: bigint }>>`INSERT INTO document_number_counters (series, business_date, last_number) VALUES ('EXP', ${dateKey}, 1) ON CONFLICT (series, business_date) DO UPDATE SET last_number = document_number_counters.last_number + 1 RETURNING last_number`;
  return `EXP-${dateKey}-${row!.last_number.toString().padStart(4, "0")}`;
}

export function previewExpense(input: ExpenseInput) { validate(input); const calculated = calculateExpense(input.items); return { transactionAt: input.transactionAt.toISOString(), items: calculated.items.map((item) => ({ ...item, quantity: item.quantity, unitPrice: item.unitPrice.toString(), lineAmount: item.lineAmount.toString() })), totalAmount: calculated.totalAmount.toString() }; }

export async function createExpense(input: ExpenseInput, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  validate(input);
  try { return await executeIdempotent({ actor, operation: "expense.create", key, transaction, payload: { ...input, transactionAt: input.transactionAt.toISOString() }, run: async (tx) => { const calculated = calculateExpense(input.items); const expenseNumber = await nextNumber(tx, input.transactionAt); const created = await tx.expense.create({ data: { expenseNumber, transactionAt: input.transactionAt, createdById: actor.id, totalAmount: calculated.totalAmount, generalNote: input.generalNote?.trim() || null, externalReceiptNumber: input.externalReceiptNumber?.trim() || null, items: { create: calculated.items.map((item) => ({ lineNumber: item.lineNumber, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, lineAmount: item.lineAmount })) } }, include }); const result = mapExpense(created); await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "EXPENSE_CREATED", objectType: "EXPENSE", objectId: created.id.toString(), beforeAfter: { after: result } }); return result; } }); } catch (error) { if (error instanceof IdempotencyError) throw new ExpenseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function updateExpense(id: bigint, input: ExpenseInput, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  validate(input);
  try { return await executeIdempotent({ actor, operation: "expense.update", key, transaction, payload: { id: id.toString(), ...input, transactionAt: input.transactionAt.toISOString() }, run: async (tx) => { await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`; const before = await tx.expense.findUnique({ where: { id }, include }); if (!before) throw new ExpenseServiceError("NOT_FOUND", "Expense tidak ditemukan."); if (before.status !== "COMPLETED") throw new ExpenseServiceError("STATE_CONFLICT", "Expense CANCELED tidak dapat diedit."); const calculated = calculateExpense(input.items); const after = await tx.expense.update({ where: { id }, data: { transactionAt: input.transactionAt, totalAmount: calculated.totalAmount, generalNote: input.generalNote?.trim() || null, externalReceiptNumber: input.externalReceiptNumber?.trim() || null, items: { deleteMany: {}, create: calculated.items.map((item) => ({ lineNumber: item.lineNumber, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, lineAmount: item.lineAmount })) } }, include }); const result = mapExpense(after); const beforeResult = mapExpense(before); const comparable = (value: ReturnType<typeof mapExpense>) => ({ expenseNumber: value.expenseNumber, transactionAt: value.transactionAt, status: value.status, totalAmount: value.totalAmount, externalReceiptNumber: value.externalReceiptNumber, items: value.items }); const material = JSON.stringify(comparable(beforeResult)) !== JSON.stringify(comparable(result)); if (material) await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "EXPENSE_UPDATED", objectType: "EXPENSE", objectId: id.toString(), beforeAfter: { before: auditValues(before), after: result } }); return result; } }); } catch (error) { if (error instanceof IdempotencyError) throw new ExpenseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function cancelExpense(id: bigint, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try { return await executeIdempotent({ actor, operation: "expense.cancel", key, transaction, payload: { id: id.toString() }, run: async (tx) => { await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`; const before = await tx.expense.findUnique({ where: { id }, include }); if (!before) throw new ExpenseServiceError("NOT_FOUND", "Expense tidak ditemukan."); if (before.status !== "COMPLETED") throw new ExpenseServiceError("STATE_CONFLICT", "Expense sudah dibatalkan atau tidak dapat dibatalkan."); const after = await tx.expense.update({ where: { id }, data: { status: "CANCELED" }, include }); const result = mapExpense(after); await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "EXPENSE_CANCELED", objectType: "EXPENSE", objectId: id.toString(), beforeAfter: { before: auditValues(before), after: result } }); return result; } }); } catch (error) { if (error instanceof IdempotencyError) throw new ExpenseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function listExpenses(canceled = false) { const rows = await prisma.expense.findMany({ where: { status: canceled ? "CANCELED" : "COMPLETED" }, include, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], take: 200 }); return rows.map(mapExpense); }
export async function getExpense(id: bigint) { const row = await prisma.expense.findUnique({ where: { id }, include }); return row ? mapExpense(row) : null; }
