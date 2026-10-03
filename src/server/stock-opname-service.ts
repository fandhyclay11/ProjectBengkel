import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";
import { applyStockOpnameAdjustment } from "@/server/stock-service";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
type Actor = { id: bigint; username: string };
type RecheckItem = { sparePartId: bigint; physicalStock: bigint | null };
export type StockOpnameInput = { transactionAt: Date };

export class StockOpnameServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "INVALID" | "FUTURE_DATE" | "STATE_CONFLICT" | "RECOUNT_REQUIRED" | "INSUFFICIENT_STOCK" | "IDEMPOTENCY_CONFLICT", message: string) { super(message); }
}

const include = { items: { include: { sparePart: { select: { stockVersion: true } } } } } as const;

function validateDate(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new StockOpnameServiceError("INVALID", "Tanggal Stock Opname tidak valid.");
  if (date.getTime() > Date.now()) throw new StockOpnameServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
}

function mapOpname(row: { id: bigint; opnameNumber: string; transactionAt: Date; status: string; createdById: bigint; finalizedById: bigint | null; finalizedAt: Date | null; revisionNumber: number; approvedById: bigint | null; approvedAt: Date | null; createdAt: Date; updatedAt: Date; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; systemStock: bigint; physicalStock: bigint | null; difference: bigint | null; capturedStockVersion: bigint; verifiedSystemStock: bigint; verifiedStockVersion: bigint; sparePart?: { stockVersion: bigint } }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), opnameNumber: row.opnameNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), status: row.status as "REVISION" | "FINALIZED" | "APPROVED", revisionNumber: row.revisionNumber,
    createdById: row.createdById.toString(), finalizedById: row.finalizedById?.toString() ?? null, finalizedAt: row.finalizedAt?.toISOString() ?? null, approvedById: row.approvedById?.toString() ?? null, approvedAt: row.approvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ lineNumber: item.lineNumber, sparePartId: item.sparePartId.toString(), code: item.partCodeSnapshot, name: item.partNameSnapshot, systemStock: item.systemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: item.difference?.toString() ?? null, capturedStockVersion: item.capturedStockVersion.toString(), ...(role === "ADMIN" ? { verifiedSystemStock: item.verifiedSystemStock.toString(), verifiedStockVersion: item.verifiedStockVersion.toString(), currentStockVersion: item.sparePart?.stockVersion.toString() ?? item.verifiedStockVersion.toString() } : {}) })),
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
    const created = await tx.stockOpname.create({ data: { opnameNumber: await nextNumber(tx, input.transactionAt), transactionAt: input.transactionAt, status: "REVISION", createdById: actor.id, items: { create: lockedParts.map((part, index) => ({ lineNumber: index + 1, sparePartId: part.id, partCodeSnapshot: part.code, partNameSnapshot: part.name, systemStock: part.stockOnHand, capturedStockVersion: part.stockVersion, verifiedSystemStock: part.stockOnHand, verifiedStockVersion: part.stockVersion })) } }, include });
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
    const staleIds = input.items.length ? input.items.map((item) => item.sparePartId) : before.items.map((item) => item.sparePartId);
    for (const sparePartId of [...staleIds].sort((a, b) => Number(a - b))) await tx.$queryRaw`SELECT id FROM spare_parts WHERE id = ${sparePartId} FOR UPDATE`;
    const currentParts = await tx.sparePart.findMany({ where: { id: { in: staleIds } }, select: { id: true, stockOnHand: true, stockVersion: true } });
    const currentById = new Map(currentParts.map((part) => [part.id.toString(), part]));
    for (const item of input.items) if (!byId.has(item.sparePartId.toString())) throw new StockOpnameServiceError("INVALID", "Item Stock Opname tidak valid.");
    const changed: Array<{ before: { code: string; systemStock: string; physicalStock: string | null; difference: string | null }; after: { code: string; systemStock: string; physicalStock: string | null; difference: string | null } }> = [];
    for (const item of input.items) {
      const old = byId.get(item.sparePartId.toString())!;
      const current = currentById.get(item.sparePartId.toString());
      if (!current) throw new StockOpnameServiceError("NOT_FOUND", "Sparepart tidak ditemukan.");
      const stale = current.stockVersion !== old.verifiedStockVersion;
      const verifiedSystemStock = stale ? current.stockOnHand : old.verifiedSystemStock;
      const verifiedStockVersion = stale ? current.stockVersion : old.verifiedStockVersion;
      const difference = item.physicalStock === null ? null : item.physicalStock - verifiedSystemStock;
      if (old.physicalStock !== item.physicalStock || old.difference !== difference || old.verifiedSystemStock !== verifiedSystemStock || old.verifiedStockVersion !== verifiedStockVersion) {
        changed.push({ before: { code: old.partCodeSnapshot, systemStock: old.verifiedSystemStock.toString(), physicalStock: old.physicalStock?.toString() ?? null, difference: old.difference?.toString() ?? null }, after: { code: old.partCodeSnapshot, systemStock: verifiedSystemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: difference?.toString() ?? null } });
      }
      await tx.stockOpnameItem.update({ where: { id: old.id }, data: { physicalStock: item.physicalStock, difference, verifiedSystemStock, verifiedStockVersion } });
    }
    const datetimeChanged = before.transactionAt.getTime() !== input.transactionAt.getTime();
    const stateChanged = changed.length > 0;
    const updated = await tx.stockOpname.update({ where: { id }, data: { transactionAt: input.transactionAt, ...(stateChanged ? { revisionNumber: { increment: 1 } } : {}) }, include });
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

export async function approveStockOpname(id: bigint, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try {
    return await executeIdempotent({ actor, operation: "stock-opname.approve", key, transaction, payload: { id: id.toString() }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_opnames WHERE id = ${id} FOR UPDATE`;
      const before = await tx.stockOpname.findUnique({ where: { id }, include });
      if (!before) throw new StockOpnameServiceError("NOT_FOUND", "Stock Opname tidak ditemukan.");
      if (before.status !== "FINALIZED") throw new StockOpnameServiceError("STATE_CONFLICT", "Stock Opname hanya dapat di-Approve dari status Finalized.");
      const orderedItems = [...before.items].sort((a, b) => Number(a.sparePartId - b.sparePartId));
      for (const item of orderedItems) await tx.$queryRaw`SELECT id FROM spare_parts WHERE id = ${item.sparePartId} FOR UPDATE`;
      const approvalOperationId = randomUUID();
      const operationName = "stock-opname.approve";
      await tx.stockOpnameApprovalOperation.create({ data: { approvalOperationId, stockOpnameId: id, revisionNumber: before.revisionNumber, actorId: actor.id, status: "IN_PROGRESS", idempotencyOperation: operationName, idempotencyRequestKey: key, adjustmentSummary: [] } });
      const currentParts = await tx.sparePart.findMany({ where: { id: { in: orderedItems.map((item) => item.sparePartId) } }, select: { id: true, stockOnHand: true, stockVersion: true, averageCost: true } });
      const currentById = new Map(currentParts.map((part) => [part.id.toString(), part]));
      const summary: Array<{ sparePartId: string; code: string; physicalStock: string; verifiedSystemStock: string; difference: string; movementType: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | null; unitCost: string | null; resultingStock: string }> = [];
      for (const item of orderedItems) {
        const part = currentById.get(item.sparePartId.toString());
        if (!part) throw new StockOpnameServiceError("NOT_FOUND", "Sparepart tidak ditemukan.");
        if (part.stockVersion !== item.verifiedStockVersion) throw new StockOpnameServiceError("RECOUNT_REQUIRED", "Stok berubah. USER harus melakukan recount sebelum approval.");
        if (item.physicalStock === null) throw new StockOpnameServiceError("INVALID", "Semua physical stock harus diisi sebelum Approve.");
        const difference = item.physicalStock - item.verifiedSystemStock;
        const resultingStock = part.stockOnHand + difference;
        if (resultingStock < 0n) throw new StockOpnameServiceError("INSUFFICIENT_STOCK", "Adjustment akan membuat stok negatif.");
        summary.push({ sparePartId: item.sparePartId.toString(), code: item.partCodeSnapshot, physicalStock: item.physicalStock.toString(), verifiedSystemStock: item.verifiedSystemStock.toString(), difference: difference.toString(), movementType: difference > 0n ? "ADJUSTMENT_IN" : difference < 0n ? "ADJUSTMENT_OUT" : null, unitCost: difference === 0n ? null : (part.averageCost?.toString() ?? null), resultingStock: resultingStock.toString() });
      }
      const movementIds: string[] = [];
      for (const item of orderedItems) {
        const difference = item.physicalStock! - item.verifiedSystemStock;
        if (difference === 0n) continue;
        const result = await applyStockOpnameAdjustment(tx, { sparePartId: item.sparePartId, quantity: difference, stockOpnameId: id, revisionNumber: before.revisionNumber, approvalOperationId, actorId: actor.id });
        movementIds.push(result.movement.id.toString());
      }
      const operationSummary = { items: summary, movementIds };
      await tx.stockOpnameApprovalOperation.update({ where: { approvalOperationId }, data: { status: "APPROVED", adjustmentSummary: operationSummary } });
      const updated = await tx.stockOpname.update({ where: { id }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() }, include });
      const result = { stockOpname: mapOpname(updated, "ADMIN"), approvalOperationId, adjustmentSummary: summary, movementIds };
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "STOCK_OPNAME_APPROVED", objectType: "STOCK_OPNAME", objectId: id.toString(), beforeAfter: { before: auditValues(before), after: result } });
      return result;
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new StockOpnameServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    throw error;
  }
}

export async function rejectStockOpname(id: bigint, reason: string | null, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try {
    return await executeIdempotent({ actor, operation: "stock-opname.reject", key, transaction, payload: { id: id.toString(), reason }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_opnames WHERE id = ${id} FOR UPDATE`;
      const before = await tx.stockOpname.findUnique({ where: { id }, include });
      if (!before) throw new StockOpnameServiceError("NOT_FOUND", "Stock Opname tidak ditemukan.");
      if (before.status !== "FINALIZED") throw new StockOpnameServiceError("STATE_CONFLICT", "Stock Opname hanya dapat di-Reject dari status Finalized.");
      const updated = await tx.stockOpname.update({ where: { id }, data: { status: "REVISION" }, include });
      const result = mapOpname(updated, "ADMIN");
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "STOCK_OPNAME_REJECTED", objectType: "STOCK_OPNAME", objectId: id.toString(), beforeAfter: { before: auditValues(before), after: result }, context: reason ? { reason } : undefined });
      return { stockOpname: result };
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new StockOpnameServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    throw error;
  }
}

export async function listStockOpnames(role: "ADMIN" | "USER", filters: { status?: "REVISION" | "FINALIZED" | "APPROVED"; from?: Date; to?: Date; search?: string } = {}) {
  const rows = await prisma.stockOpname.findMany({ where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.search ? { opnameNumber: { contains: filters.search, mode: "insensitive" } } : {}), ...(filters.from || filters.to ? { transactionAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}) }, include, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], take: 200 });
  return rows.map((row) => mapOpname(row, role));
}

export async function getStockOpname(id: bigint, role: "ADMIN" | "USER") { const row = await prisma.stockOpname.findUnique({ where: { id }, include }); return row ? mapOpname(row, role) : null; }
