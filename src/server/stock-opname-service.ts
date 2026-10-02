import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
type Actor = { id: bigint; username: string };
type RecheckItem = { sparePartId: bigint; physicalStock: bigint | null };
export type StockOpnameInput = { transactionAt: Date };

export class StockOpnameServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "INVALID" | "FUTURE_DATE" | "STATE_CONFLICT" | "IDEMPOTENCY_CONFLICT", message: string) { super(message); }
}

const include = { items: true } as const;

function validateDate(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new StockOpnameServiceError("INVALID", "Tanggal Stock Opname tidak valid.");
  if (date.getTime() > Date.now()) throw new StockOpnameServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
}

function mapOpname(row: { id: bigint; opnameNumber: string; transactionAt: Date; status: string; createdById: bigint; finalizedById: bigint | null; finalizedAt: Date | null; createdAt: Date; updatedAt: Date; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; systemStock: bigint; physicalStock: bigint | null; difference: bigint | null }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), opnameNumber: row.opnameNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), status: row.status as "REVISION" | "FINALIZED" | "APPROVED",
    createdById: row.createdById.toString(), finalizedById: row.finalizedById?.toString() ?? null, finalizedAt: row.finalizedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ lineNumber: item.lineNumber, sparePartId: item.sparePartId.toString(), code: item.partCodeSnapshot, name: item.partNameSnapshot, systemStock: item.systemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: item.difference?.toString() ?? null, ...(role === "ADMIN" ? {} : {}) })),
  };
}

function auditValues(row: Parameters<typeof mapOpname>[0]) { return mapOpname(row, "ADMIN"); }

async function nextNumber(tx: Prisma.TransactionClient, date: Date) {
  const dateKey = workshopDateKey(date);
  const [row] = await tx.$queryRaw<Array<{ last_number: bigint }>>`INSERT INTO document_number_counters (series, business_date, last_number) VALUES ('OPN', ${dateKey}, 1) ON CONFLICT (series, business_date) DO UPDATE SET last_number = document_number_counters.last_number + 1 RETURNING last_number`;
  return `OPN-${dateKey}-${row!.last_number.toString().padStart(4, "0")}`;
}

function parsePhysical(value: bigint | null) {
  if (value !== null && (value < 0n || value > MAX_BIGINT)) throw new StockOpnameServiceError("INVALID", "Physical stock harus berupa integer pcs yang tidak negatif.");
}

export async function createStockOpname(input: StockOpnameInput, actor: Actor, key: string, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateDate(input.transactionAt);
  try { return await executeIdempotent({ actor, operation: "stock-opname.create", key, transaction, payload: { transactionAt: input.transactionAt.toISOString() }, run: async (tx) => {
    const parts = await tx.sparePart.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true, stockOnHand: true, stockVersion: true } });
    for (const part of parts) await tx.$queryRaw`SELECT id FROM spare_parts WHERE id = ${part.id} FOR UPDATE`;
    const lockedParts = parts.length ? await tx.sparePart.findMany({ where: { id: { in: parts.map((part) => part.id) } }, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, stockOnHand: true, stockVersion: true } }) : [];
    const created = await tx.stockOpname.create({ data: { opnameNumber: await nextNumber(tx, input.transactionAt), transactionAt: input.transactionAt, status: "REVISION", createdById: actor.id, items: { create: lockedParts.map((part, index) => ({ lineNumber: index + 1, sparePartId: part.id, partCodeSnapshot: part.code, partNameSnapshot: part.name, systemStock: part.stockOnHand, capturedStockVersion: part.stockVersion })) } }, include });
    const result = mapOpname(created, role);
    await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "STOCK_OPNAME_CREATED", objectType: "STOCK_OPNAME", objectId: created.id.toString(), beforeAfter: { after: result } });
    return result;
  } }); } catch (error) { if (error instanceof IdempotencyError) throw new StockOpnameServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function recheckStockOpname(id: bigint, input: StockOpnameInput & { items: RecheckItem[] }, actor: Actor, key: string, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateDate(input.transactionAt); input.items.forEach((item) => parsePhysical(item.physicalStock));
  try { return await executeIdempotent({ actor, operation: "stock-opname.recheck", key, transaction, payload: { id: id.toString(), transactionAt: input.transactionAt.toISOString(), items: input.items }, run: async (tx) => {
    await tx.$queryRaw`SELECT id FROM stock_opnames WHERE id = ${id} FOR UPDATE`;
    const before = await tx.stockOpname.findUnique({ where: { id }, include });
    if (!before) throw new StockOpnameServiceError("NOT_FOUND", "Stock Opname tidak ditemukan.");
    if (before.status === "APPROVED") throw new StockOpnameServiceError("STATE_CONFLICT", "Stock Opname yang sudah Approved tidak dapat direvisi.");
    const byId = new Map(before.items.map((item) => [item.sparePartId.toString(), item]));
    for (const item of input.items) if (!byId.has(item.sparePartId.toString())) throw new StockOpnameServiceError("INVALID", "Item Stock Opname tidak valid.");
    const changed: Array<{ before: { code: string; systemStock: string; physicalStock: string | null; difference: string | null }; after: { code: string; systemStock: string; physicalStock: string | null; difference: string | null } }> = [];
    for (const item of input.items) {
      const old = byId.get(item.sparePartId.toString())!;
      const difference = item.physicalStock === null ? null : item.physicalStock - old.systemStock;
      if (old.physicalStock !== item.physicalStock || old.difference !== difference) {
        changed.push({ before: { code: old.partCodeSnapshot, systemStock: old.systemStock.toString(), physicalStock: old.physicalStock?.toString() ?? null, difference: old.difference?.toString() ?? null }, after: { code: old.partCodeSnapshot, systemStock: old.systemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: difference?.toString() ?? null } });
      }
      await tx.stockOpnameItem.update({ where: { id: old.id }, data: { physicalStock: item.physicalStock, difference } });
    }
    const datetimeChanged = before.transactionAt.getTime() !== input.transactionAt.getTime();
    const updated = await tx.stockOpname.update({ where: { id }, data: { transactionAt: input.transactionAt }, include });
    const result = mapOpname(updated, role);
    if (changed.length || datetimeChanged) await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "STOCK_OPNAME_RECHECKED", objectType: "STOCK_OPNAME", objectId: id.toString(), beforeAfter: { before: { transactionAt: before.transactionAt.toISOString(), items: changed.map((item) => item.before) }, after: { transactionAt: input.transactionAt.toISOString(), items: changed.map((item) => item.after) } } });
    return result;
  } }); } catch (error) { if (error instanceof IdempotencyError) throw new StockOpnameServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function finalizeStockOpname(id: bigint, actor: Actor, key: string, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  try { return await executeIdempotent({ actor, operation: "stock-opname.finalize", key, transaction, payload: { id: id.toString() }, run: async (tx) => {
    await tx.$queryRaw`SELECT id FROM stock_opnames WHERE id = ${id} FOR UPDATE`;
    const before = await tx.stockOpname.findUnique({ where: { id }, include });
    if (!before) throw new StockOpnameServiceError("NOT_FOUND", "Stock Opname tidak ditemukan.");
    if (before.status !== "REVISION") throw new StockOpnameServiceError("STATE_CONFLICT", "Stock Opname tidak berada pada status Revision.");
    if (before.items.some((item) => item.physicalStock === null)) throw new StockOpnameServiceError("INVALID", "Semua physical stock harus diisi sebelum Finalize.");
    const updated = await tx.stockOpname.update({ where: { id }, data: { status: "FINALIZED", finalizedById: actor.id, finalizedAt: new Date() }, include });
    const result = mapOpname(updated, role);
    await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "STOCK_OPNAME_FINALIZED", objectType: "STOCK_OPNAME", objectId: id.toString(), beforeAfter: { before: auditValues(before), after: result } });
    return result;
  } }); } catch (error) { if (error instanceof IdempotencyError) throw new StockOpnameServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message); throw error; }
}

export async function listStockOpnames(role: "ADMIN" | "USER", filters: { status?: "REVISION" | "FINALIZED" | "APPROVED"; from?: Date; to?: Date; search?: string } = {}) {
  const rows = await prisma.stockOpname.findMany({ where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.search ? { opnameNumber: { contains: filters.search, mode: "insensitive" } } : {}), ...(filters.from || filters.to ? { transactionAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}) }, include, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], take: 200 });
  return rows.map((row) => mapOpname(row, role));
}

export async function getStockOpname(id: bigint, role: "ADMIN" | "USER") { const row = await prisma.stockOpname.findUnique({ where: { id }, include }); return row ? mapOpname(row, role) : null; }
