import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { applyStockDelta, applyStockMovement, StockServiceError } from "@/server/stock-service";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateRange, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
type Actor = { id: bigint; username: string };
type ItemInput = { sparePartId: bigint; quantity: bigint; sellingPrice?: bigint };
export type SlsInput = { transactionAt: Date; discount: bigint; items: ItemInput[] };

export class SlsServiceError extends Error {
  constructor(readonly kind: "INVALID" | "FUTURE_DATE" | "INSUFFICIENT_STOCK" | "STATE_CONFLICT" | "IDEMPOTENCY_CONFLICT", message: string) { super(message); }
}

type Part = { id: bigint; code: string; name: string; sellingPrice: bigint; latestBuyPrice: bigint | null; averageCost: bigint | null };

function validateInput(input: SlsInput) {
  if (!Number.isFinite(input.transactionAt.getTime())) throw new SlsServiceError("INVALID", "Tanggal SLS tidak valid.");
  if (input.transactionAt.getTime() > Date.now()) throw new SlsServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
  if (!input.items.length) throw new SlsServiceError("INVALID", "SLS harus memiliki minimal satu item.");
  if (input.discount < 0n || input.discount > MAX_BIGINT) throw new SlsServiceError("INVALID", "Discount tidak valid.");
  const seen = new Set<string>();
  for (const item of input.items) {
    const id = item.sparePartId.toString();
    if (seen.has(id)) throw new SlsServiceError("INVALID", "Sparepart yang sama tidak boleh muncul lebih dari sekali dalam satu SLS.");
    seen.add(id);
    if (item.quantity <= 0n || item.quantity > MAX_BIGINT || (item.sellingPrice !== undefined && (item.sellingPrice <= 0n || item.sellingPrice > MAX_BIGINT))) throw new SlsServiceError("INVALID", "Jumlah dan harga jual SLS harus berupa bilangan bulat lebih dari Rp0.");
  }
}

async function readParts(repository: Prisma.TransactionClient | typeof prisma, items: ItemInput[]) {
  const ids = [...new Set(items.map((item) => item.sparePartId))];
  const parts = await repository.sparePart.findMany({ where: { id: { in: ids }, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true, sellingPrice: true, latestBuyPrice: true, averageCost: true } });
  if (parts.length !== ids.length) throw new SlsServiceError("INVALID", "Sparepart tidak aktif atau tidak ditemukan.");
  return parts as Part[];
}

function calculate(input: SlsInput, parts: Part[], role: "ADMIN" | "USER") {
  const byId = new Map(parts.map((part) => [part.id.toString(), part]));
  const items = input.items.map((item, index) => {
    const part = byId.get(item.sparePartId.toString())!;
    if (part.averageCost === null) throw new SlsServiceError("STATE_CONFLICT", "Average Cost belum tersedia untuk sparepart yang digunakan.");
    const sellingPrice = item.sellingPrice ?? part.sellingPrice;
    const lineAmount = item.quantity * sellingPrice;
    const lineHpp = item.quantity * part.averageCost;
    if (lineAmount > MAX_BIGINT || lineHpp > MAX_BIGINT) throw new SlsServiceError("INVALID", "Nilai SLS di luar batas penyimpanan.");
    return { lineNumber: index + 1, part, quantity: item.quantity, sellingPrice, lineAmount, unitHppSnapshot: part.averageCost, lineHpp, belowLatestBuyPrice: part.latestBuyPrice !== null && sellingPrice < part.latestBuyPrice };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineAmount, 0n);
  const totalAmount = subtotal - input.discount;
  const totalHpp = items.reduce((sum, item) => sum + item.lineHpp, 0n);
  if (subtotal > MAX_BIGINT || input.discount > subtotal || totalAmount < 0n || totalHpp > MAX_BIGINT) throw new SlsServiceError("INVALID", "Subtotal, discount, atau total SLS tidak valid.");
  const sensitive = role === "ADMIN";
  return {
    transactionAt: input.transactionAt.toISOString(),
    items: items.map((item) => ({ sparePartId: item.part.id.toString(), lineNumber: item.lineNumber, code: item.part.code, name: item.part.name, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), belowLatestBuyPrice: item.belowLatestBuyPrice, ...(sensitive ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() } : {}) })),
    subtotal: subtotal.toString(), discount: input.discount.toString(), totalAmount: totalAmount.toString(), ...(sensitive ? { totalHpp: totalHpp.toString() } : {}),
  };
}

async function nextSlsNumber(tx: Prisma.TransactionClient, date: Date) {
  const dateKey = workshopDateKey(date);
  const [row] = await tx.$queryRaw<Array<{ last_number: bigint }>>`
    INSERT INTO document_number_counters (series, business_date, last_number)
    VALUES ('SLS', ${dateKey}, 1)
    ON CONFLICT (series, business_date)
    DO UPDATE SET last_number = document_number_counters.last_number + 1
    RETURNING last_number
  `;
  return `SLS-${dateKey}-${row!.last_number.toString().padStart(4, "0")}`;
}

function mapSls(row: { id: bigint; slsNumber: string; transactionAt: Date; status: string; editCount: number; createdById: bigint; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), slsNumber: row.slsNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), status: row.status, ...(role === "ADMIN" ? { editCount: row.editCount } : {}),
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber, code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), ...(role === "ADMIN" ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() } : {}) })),
    subtotal: row.subtotal.toString(), discount: row.discount.toString(), totalAmount: row.totalAmount.toString(), ...(role === "ADMIN" ? { totalHpp: row.totalHpp.toString(), createdById: row.createdById.toString() } : {}),
  };
}

const slsInclude = { items: true } as const;

async function createSlsRevision(tx: Prisma.TransactionClient, sls: { id: bigint; transactionAt: Date; status: "COMPLETED" | "CANCELED"; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; createdById: bigint }, actorId: bigint, revisionNumber: number, items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }>) {
  return tx.slsRevision.create({ data: { slsId: sls.id, revisionNumber, transactionAt: sls.transactionAt, status: sls.status, subtotal: sls.subtotal, discount: sls.discount, totalAmount: sls.totalAmount, totalHpp: sls.totalHpp, createdById: actorId, items: { create: items.map((item) => ({ sparePartId: item.sparePartId, lineNumber: item.lineNumber, partCodeSnapshot: item.partCodeSnapshot, partNameSnapshot: item.partNameSnapshot, quantity: item.quantity, sellingPrice: item.sellingPrice, lineAmount: item.lineAmount, unitHppSnapshot: item.unitHppSnapshot, lineHpp: item.lineHpp })) } } });
}

function auditSlsValues(sls: { slsNumber: string; transactionAt: Date; status: string; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; items: Array<{ partCodeSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }) {
  return { slsNumber: sls.slsNumber, transactionAt: sls.transactionAt.toISOString(), status: sls.status, subtotal: sls.subtotal.toString(), discount: sls.discount.toString(), totalAmount: sls.totalAmount.toString(), totalHpp: sls.totalHpp.toString(), items: sls.items.map((item) => ({ code: item.partCodeSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() })) };
}

export async function previewSls(input: SlsInput, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateInput(input);
  return calculate(input, await readParts(transaction ?? prisma, input.items), role);
}

export async function createSls(input: SlsInput, actor: Actor, key: string, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateInput(input);
  try {
    return await executeIdempotent({ actor, operation: "sls.create", key, transaction, payload: { transactionAt: input.transactionAt.toISOString(), discount: input.discount, items: input.items }, run: async (tx) => {
      const ids = [...new Set(input.items.map((item) => item.sparePartId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const id of ids) {
        const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM spare_parts WHERE id = ${id} FOR UPDATE`;
        if (!rows.length) throw new SlsServiceError("INVALID", "Sparepart tidak ditemukan.");
      }
      const parts = await readParts(tx, input.items);
      const calculated = calculate(input, parts, role);
      const adminCalculated = role === "ADMIN" ? calculated : calculate(input, parts, "ADMIN");
      const slsNumber = await nextSlsNumber(tx, input.transactionAt);
      const created = await tx.sls.create({ data: { slsNumber, transactionAt: input.transactionAt, status: "COMPLETED", createdById: actor.id, subtotal: BigInt(calculated.subtotal), discount: BigInt(calculated.discount), totalAmount: BigInt(calculated.totalAmount), totalHpp: BigInt(adminCalculated.totalHpp!) } });
      for (const [index, item] of input.items.entries()) {
        const part = parts.find((candidate) => candidate.id === item.sparePartId)!;
        const sellingPrice = item.sellingPrice ?? part.sellingPrice;
        const stock = await applyStockMovement(tx, { sparePartId: part.id, movementType: "SLS_ISSUE", quantity: -item.quantity, unitCost: part.averageCost!, sourceType: "SLS", sourceId: created.id.toString(), sourceRevision: 0, sourceOperation: "CREATE", actorId: actor.id });
        await tx.slsItem.create({ data: { slsId: created.id, sparePartId: part.id, lineNumber: index + 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: item.quantity, sellingPrice, lineAmount: item.quantity * sellingPrice, unitHppSnapshot: stock.unitCost, lineHpp: item.quantity * stock.unitCost } });
      }
      const complete = await tx.sls.findUniqueOrThrow({ where: { id: created.id }, include: slsInclude });
      await createSlsRevision(tx, complete, actor.id, 0, complete.items);
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SLS_CREATED", objectType: "SLS", objectId: created.id.toString(), beforeAfter: { after: { slsNumber, status: "COMPLETED", transactionAt: input.transactionAt.toISOString(), items: calculated.items, subtotal: calculated.subtotal, discount: calculated.discount, totalAmount: calculated.totalAmount, totalHpp: complete.totalHpp.toString() } } });
      return mapSls(complete, role);
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SlsServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new SlsServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function updateCompletedSls(id: bigint, input: SlsInput & { reason: string }, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  validateInput(input);
  const reason = input.reason.trim();
  if (!reason) throw new SlsServiceError("INVALID", "Alasan edit wajib diisi.");
  try {
    return await executeIdempotent({ actor, operation: "sls.update-completed", key, transaction, payload: { id: id.toString(), input: { ...input, transactionAt: input.transactionAt.toISOString(), reason } }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM sls WHERE id = ${id} FOR UPDATE`;
      const before = await tx.sls.findUnique({ where: { id }, include: slsInclude });
      if (!before) throw new SlsServiceError("INVALID", "SLS tidak ditemukan.");
      if (before.status !== "COMPLETED" || before.editCount >= 1) throw new SlsServiceError("STATE_CONFLICT", "SLS Completed hanya dapat diedit satu kali.");
      const revision0 = await tx.slsRevision.findUnique({ where: { slsId_revisionNumber: { slsId: id, revisionNumber: 0 } } });
      if (!revision0 || await tx.slsRevision.findUnique({ where: { slsId_revisionNumber: { slsId: id, revisionNumber: 1 } } })) throw new SlsServiceError("STATE_CONFLICT", "Revision SLS tidak valid untuk edit.");
      const ids = [...new Set([...before.items.map((item) => item.sparePartId), ...input.items.map((item) => item.sparePartId)])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const partId of ids) await tx.$queryRaw`SELECT id FROM spare_parts WHERE id = ${partId} FOR UPDATE`;
      const parts = await readParts(tx, input.items);
      const calculated = calculate(input, parts, "ADMIN");
      const revision0Items = await tx.slsRevisionItem.findMany({ where: { revisionId: revision0.id } });
      const oldByPart = new Map(revision0Items.map((item) => [item.sparePartId.toString(), item]));
      const newByPart = new Map(input.items.map((item) => [item.sparePartId.toString(), item]));
      for (const partId of ids) {
        const oldQuantity = oldByPart.get(partId.toString())?.quantity ?? 0n;
        const newQuantity = newByPart.get(partId.toString())?.quantity ?? 0n;
        const delta = oldQuantity - newQuantity;
        if (delta !== 0n) await applyStockDelta(tx, { sparePartId: partId, quantityDelta: delta, movementType: "CORRECTION", sourceType: "SLS", sourceId: id.toString(), sourceRevision: 1, sourceOperation: "EDIT", actorId: actor.id, unitCost: newByPart.get(partId.toString()) ? parts.find((part) => part.id === partId)?.averageCost ?? undefined : oldByPart.get(partId.toString())?.unitHppSnapshot });
      }
      const updated = await tx.sls.update({ where: { id }, data: { transactionAt: input.transactionAt, subtotal: BigInt(calculated.subtotal), discount: BigInt(calculated.discount), totalAmount: BigInt(calculated.totalAmount), totalHpp: BigInt(calculated.totalHpp!), editCount: 1, items: { deleteMany: {}, create: calculated.items.map((item) => ({ sparePartId: BigInt(item.sparePartId), lineNumber: Number(item.lineNumber), partCodeSnapshot: String(item.code), partNameSnapshot: String(item.name), quantity: BigInt(item.quantity), sellingPrice: BigInt(item.sellingPrice), lineAmount: BigInt(item.lineAmount), unitHppSnapshot: BigInt(item.unitHppSnapshot!), lineHpp: BigInt(item.lineHpp!) })) } }, include: slsInclude });
      await createSlsRevision(tx, updated, actor.id, 1, updated.items);
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SLS_COMPLETED_EDITED", objectType: "SLS", objectId: id.toString(), beforeAfter: { reason, before: auditSlsValues(before), after: auditSlsValues(updated) } });
      return mapSls(updated, "ADMIN");
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SlsServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new SlsServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function cancelSls(id: bigint, reasonInput: string, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  const reason = reasonInput.trim();
  if (!reason) throw new SlsServiceError("INVALID", "Alasan pembatalan wajib diisi.");
  try {
    return await executeIdempotent({ actor, operation: "sls.cancel", key, transaction, payload: { id: id.toString(), reason }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM sls WHERE id = ${id} FOR UPDATE`;
      const sls = await tx.sls.findUnique({ where: { id }, include: slsInclude });
      if (!sls) throw new SlsServiceError("INVALID", "SLS tidak ditemukan.");
      if (sls.status !== "COMPLETED") throw new SlsServiceError("STATE_CONFLICT", "SLS sudah dibatalkan atau tidak dapat dibatalkan.");
      const revision = await tx.slsRevision.findFirst({ where: { slsId: id }, orderBy: { revisionNumber: "desc" }, include: { items: true } });
      if (!revision) throw new SlsServiceError("STATE_CONFLICT", "Revision SLS tidak tersedia.");
      const movements = await tx.stockMovement.findMany({ where: { sourceType: "SLS", sourceId: id.toString(), movementType: { in: ["SLS_ISSUE", "CORRECTION"] } }, orderBy: { id: "asc" } });
      const net = new Map<string, bigint>();
      for (const movement of movements) net.set(movement.sparePartId.toString(), (net.get(movement.sparePartId.toString()) ?? 0n) + movement.quantity);
      for (const [partId, quantity] of net) if (quantity !== 0n) {
        const item = revision.items.find((candidate) => candidate.sparePartId.toString() === partId);
        const original = movements.find((movement) => movement.sparePartId.toString() === partId && movement.movementType === "SLS_ISSUE");
        await applyStockDelta(tx, { sparePartId: BigInt(partId), quantityDelta: -quantity, movementType: "REVERSAL", sourceType: "SLS", sourceId: id.toString(), sourceRevision: revision.revisionNumber, sourceOperation: "CANCEL", actorId: actor.id, unitCost: item?.unitHppSnapshot, reversalOfId: original?.id });
      }
      const canceled = await tx.sls.update({ where: { id }, data: { status: "CANCELED" }, include: slsInclude });
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SLS_CANCELED", objectType: "SLS", objectId: id.toString(), beforeAfter: { reason, before: auditSlsValues(sls), after: auditSlsValues(canceled) } });
      return mapSls(canceled, "ADMIN");
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SlsServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new SlsServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function listSls(role: "ADMIN" | "USER", date: string) {
  const range = workshopDateRange(date, date);
  const rows = await prisma.sls.findMany({ where: { transactionAt: { gte: range.from, lt: range.toExclusive } }, include: slsInclude, orderBy: [{ transactionAt: "desc" }, { id: "desc" }] });
  return rows.map((row) => mapSls(row, role));
}

export async function getSls(id: bigint, role: "ADMIN" | "USER") {
  const row = await prisma.sls.findUnique({ where: { id }, include: slsInclude });
  return row ? mapSls(row, role) : null;
}
