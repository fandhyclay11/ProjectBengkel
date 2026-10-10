import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { applyPurchaseInventoryDelta, applyStockMovement, StockServiceError } from "@/server/stock-service";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateRange, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
type Actor = { id: bigint; username: string };
type PurchaseLineInput = { sparePartId: bigint; quantity: bigint; unitBuyPrice: bigint };
type DraftInput = { transactionAt: Date; supplierName: string; items: PurchaseLineInput[] };

export class PurchaseServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "INVALID" | "FUTURE_DATE" | "STATE_CONFLICT" | "INSUFFICIENT_STOCK" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
  }
}

type ItemValue = PurchaseLineInput & { lineNumber: number; lineAmount: bigint; partCodeSnapshot: string; partNameSnapshot: string };

function makeItems(input: PurchaseLineInput[], parts: Array<{ id: bigint; code: string; name: string }>, requireItem = true): { items: ItemValue[]; totalAmount: bigint } {
  if (requireItem && !input.length) throw new PurchaseServiceError("INVALID", "Purchase harus memiliki minimal satu item.");
  const seen = new Set<string>();
  const partById = new Map(parts.map((part) => [part.id.toString(), part]));
  let totalAmount = 0n;
  const items = input.map((line, index) => {
    if (line.quantity <= 0n || line.quantity > MAX_BIGINT || line.unitBuyPrice <= 0n || line.unitBuyPrice > MAX_BIGINT) {
      throw new PurchaseServiceError("INVALID", "Jumlah dan harga beli harus berupa bilangan bulat lebih dari Rp0.");
    }
    const key = line.sparePartId.toString();
    if (seen.has(key)) throw new PurchaseServiceError("INVALID", "Sparepart yang sama tidak boleh muncul lebih dari sekali dalam satu Purchase.");
    seen.add(key);
    const part = partById.get(key);
    if (!part) throw new PurchaseServiceError("INVALID", "Sparepart tidak aktif atau tidak ditemukan.");
    const lineAmount = line.quantity * line.unitBuyPrice;
    if (lineAmount > MAX_BIGINT || totalAmount + lineAmount > MAX_BIGINT) {
      throw new PurchaseServiceError("INVALID", "Total Purchase di luar batas penyimpanan.");
    }
    totalAmount += lineAmount;
    return { ...line, lineNumber: index + 1, lineAmount, partCodeSnapshot: part.code, partNameSnapshot: part.name };
  });
  return { items, totalAmount };
}

async function readActiveParts(tx: Prisma.TransactionClient, items: PurchaseLineInput[]) {
  const ids = [...new Set(items.map((item) => item.sparePartId))];
  const parts = await tx.sparePart.findMany({ where: { id: { in: ids }, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true } });
  if (parts.length !== ids.length) throw new PurchaseServiceError("INVALID", "Sparepart tidak aktif atau tidak ditemukan.");
  return parts;
}

async function lockParts(tx: Prisma.TransactionClient, sparePartIds: bigint[]) {
  for (const id of [...new Set(sparePartIds)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM spare_parts WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new PurchaseServiceError("INVALID", "Sparepart tidak ditemukan.");
  }
}

async function lockDateNumber(tx: Prisma.TransactionClient, dateKey: string) {
  const [row] = await tx.$queryRaw<Array<{ last_number: bigint }>>`
    INSERT INTO document_number_counters (series, business_date, last_number)
    VALUES ('PUR', ${dateKey}, 1)
    ON CONFLICT (series, business_date)
    DO UPDATE SET last_number = document_number_counters.last_number + 1
    RETURNING last_number
  `;
  return `PUR-${dateKey}-${row!.last_number.toString().padStart(4, "0")}`;
}

function assertValidTransactionAt(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new PurchaseServiceError("INVALID", "Tanggal Purchase tidak valid.");
  if (value.getTime() > Date.now()) throw new PurchaseServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
}

function auditPurchaseValues(purchase: {
  purchaseNumber: string; transactionAt: Date; supplierName: string; status: string; totalAmount: bigint;
  items: Array<{ partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; unitBuyPrice: bigint; lineAmount: bigint }>;
}) {
  return {
    purchaseNumber: purchase.purchaseNumber,
    transactionAt: purchase.transactionAt.toISOString(),
    supplierName: purchase.supplierName,
    status: purchase.status,
    totalAmount: purchase.totalAmount.toString(),
    items: purchase.items.map((item) => ({ code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), unitBuyPrice: item.unitBuyPrice.toString(), lineAmount: item.lineAmount.toString() })),
  };
}

async function rejectIfPurchaseStockWasUsed(tx: Prisma.TransactionClient, purchase: {
  id: bigint; confirmedAt: Date | null;
}, sparePartIds: bigint[]) {
  if (!sparePartIds.length) return;
  if (!purchase.confirmedAt) throw new PurchaseServiceError("STATE_CONFLICT", "Waktu Confirm Purchase tidak tersedia.");
  const used = await tx.stockMovement.findFirst({
    where: {
      sparePartId: { in: sparePartIds },
      quantity: { lt: 0n },
      occurredAt: { gte: purchase.confirmedAt },
      NOT: { AND: [{ sourceId: purchase.id.toString() }, { sourceType: { in: ["PURCHASE_EDIT", "PURCHASE_CANCEL"] } }] },
    },
    select: { id: true },
  });
  if (used) throw new PurchaseServiceError("STATE_CONFLICT", "Item tidak dapat diubah atau Purchase dibatalkan karena sudah ada pengeluaran stok setelah Confirm.");
}

async function refreshLatestBuyPrices(tx: Prisma.TransactionClient, sparePartIds: bigint[]) {
  for (const sparePartId of [...new Set(sparePartIds)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const candidates = await tx.purchaseItem.findMany({
      where: { sparePartId, purchase: { status: "COMPLETED", confirmedAt: { not: null } } },
      select: { unitBuyPrice: true, purchase: { select: { id: true, confirmedAt: true } } },
    });
    candidates.sort((left, right) => {
      const timeDifference = right.purchase.confirmedAt!.getTime() - left.purchase.confirmedAt!.getTime();
      if (timeDifference !== 0) return timeDifference;
      return left.purchase.id > right.purchase.id ? -1 : left.purchase.id < right.purchase.id ? 1 : 0;
    });
    await tx.sparePart.update({ where: { id: sparePartId }, data: { latestBuyPrice: candidates[0]?.unitBuyPrice ?? null } });
  }
}

function fullPurchaseDto(purchase: {
  id: bigint; purchaseNumber: string; transactionAt: Date; supplierName: string; status: string; totalAmount: bigint; createdById: bigint; confirmedAt: Date | null; editCount: number;
  items: Array<{ id: bigint; sparePartId: bigint; lineNumber: number; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; unitBuyPrice: bigint; lineAmount: bigint }>;
}) {
  return {
    id: purchase.id.toString(), purchaseNumber: purchase.purchaseNumber,
    transactionAt: purchase.transactionAt.toISOString(), supplierName: purchase.supplierName,
    transactionInput: workshopDateTimeInput(purchase.transactionAt), transactionDisplay: workshopDateTimeDisplay(purchase.transactionAt),
    status: purchase.status as "DRAFT" | "COMPLETED" | "CANCELED", totalAmount: purchase.totalAmount.toString(),
    editCount: purchase.editCount,
    createdById: purchase.createdById.toString(), confirmedAt: purchase.confirmedAt?.toISOString() ?? null,
    items: purchase.items.sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({
      id: item.id.toString(), sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber,
      code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(),
      unitBuyPrice: item.unitBuyPrice.toString(), lineAmount: item.lineAmount.toString(),
    })),
  };
}

function userPurchaseDto(purchase: Parameters<typeof fullPurchaseDto>[0]) {
  return {
    id: purchase.id.toString(), purchaseNumber: purchase.purchaseNumber,
    transactionAt: purchase.transactionAt.toISOString(), supplierName: purchase.supplierName,
    transactionDisplay: workshopDateTimeDisplay(purchase.transactionAt),
    status: purchase.status as "DRAFT" | "COMPLETED" | "CANCELED",
    items: purchase.items.sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({
      sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber, code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(),
    })),
  };
}

const purchaseInclude = { items: true } as const;

export async function listPurchases(role: "ADMIN" | "USER", date: string) {
  const range = workshopDateRange(date, date);
  const rows = await prisma.purchase.findMany({
    where: { ...(role === "ADMIN" ? {} : { status: { not: "DRAFT" } }), transactionAt: { gte: range.from, lt: range.toExclusive } },
    include: purchaseInclude,
    orderBy: [{ transactionAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => role === "ADMIN" ? fullPurchaseDto(row) : userPurchaseDto(row));
}

export async function getPurchase(id: bigint, role: "ADMIN" | "USER") {
  const row = await prisma.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!row || (role === "USER" && row.status === "DRAFT")) return null;
  return role === "ADMIN" ? fullPurchaseDto(row) : userPurchaseDto(row);
}

export async function createPurchaseDraft(input: DraftInput, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  assertValidTransactionAt(input.transactionAt);
  if (input.supplierName.length > 200) throw new PurchaseServiceError("INVALID", "Nama supplier terlalu panjang.");
  try {
    return await executeIdempotent({
      actor, operation: "purchase.create-draft", key,
      transaction,
      payload: { transactionAt: input.transactionAt, supplierName: input.supplierName, items: input.items },
      run: async (tx) => {
        const parts = await readActiveParts(tx, input.items);
        const prepared = makeItems(input.items, parts);
        const purchaseNumber = await lockDateNumber(tx, workshopDateKey(input.transactionAt));
        const created = await tx.purchase.create({
          data: {
            purchaseNumber, transactionAt: input.transactionAt, supplierName: input.supplierName,
            createdById: actor.id, totalAmount: prepared.totalAmount,
            items: { create: prepared.items.map((item) => ({ sparePartId: item.sparePartId, lineNumber: item.lineNumber, partCodeSnapshot: item.partCodeSnapshot, partNameSnapshot: item.partNameSnapshot, quantity: item.quantity, unitBuyPrice: item.unitBuyPrice, lineAmount: item.lineAmount })) },
          }, include: purchaseInclude,
        });
        await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_DRAFT_CREATED", objectType: "PURCHASE", objectId: created.id.toString(), beforeAfter: { after: { purchaseNumber, status: created.status, supplierName: created.supplierName, totalAmount: created.totalAmount.toString(), items: prepared.items.map((item) => ({ code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), unitBuyPrice: item.unitBuyPrice.toString() })) } } });
        return fullPurchaseDto(created);
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    throw error;
  }
}

export async function updatePurchaseDraft(id: bigint, input: DraftInput, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  assertValidTransactionAt(input.transactionAt);
  if (input.supplierName.length > 200) throw new PurchaseServiceError("INVALID", "Nama supplier terlalu panjang.");
  try {
    return await executeIdempotent({
      actor, operation: "purchase.update-draft", key,
      transaction,
      payload: { id: id.toString(), transactionAt: input.transactionAt, supplierName: input.supplierName, items: input.items },
      run: async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
        const before = await tx.purchase.findUnique({ where: { id }, include: purchaseInclude });
        if (!before) throw new PurchaseServiceError("NOT_FOUND", "Purchase tidak ditemukan.");
        if (before.status !== "DRAFT") throw new PurchaseServiceError("STATE_CONFLICT", "Hanya Purchase Draft yang dapat diubah.");
        const prepared = makeItems(input.items, await readActiveParts(tx, input.items));
        const updated = await tx.purchase.update({
          where: { id },
          data: {
            transactionAt: input.transactionAt, supplierName: input.supplierName, totalAmount: prepared.totalAmount,
            items: {
              deleteMany: {},
              create: prepared.items.map((item) => ({ sparePartId: item.sparePartId, lineNumber: item.lineNumber, partCodeSnapshot: item.partCodeSnapshot, partNameSnapshot: item.partNameSnapshot, quantity: item.quantity, unitBuyPrice: item.unitBuyPrice, lineAmount: item.lineAmount })),
            },
          }, include: purchaseInclude,
        });
        await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_DRAFT_UPDATED", objectType: "PURCHASE", objectId: id.toString(), beforeAfter: { before: { supplierName: before.supplierName, transactionAt: before.transactionAt.toISOString(), totalAmount: before.totalAmount.toString() }, after: { supplierName: updated.supplierName, transactionAt: updated.transactionAt.toISOString(), totalAmount: updated.totalAmount.toString() } } });
        return fullPurchaseDto(updated);
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    throw error;
  }
}

export async function deletePurchaseDraft(id: bigint, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try {
    return await executeIdempotent({
      actor, operation: "purchase.delete-draft", key, payload: { id: id.toString() },
      transaction,
      run: async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
        const purchase = await tx.purchase.findUnique({ where: { id }, include: purchaseInclude });
        if (!purchase) throw new PurchaseServiceError("NOT_FOUND", "Purchase tidak ditemukan.");
        if (purchase.status !== "DRAFT") throw new PurchaseServiceError("STATE_CONFLICT", "Purchase yang sudah dikonfirmasi tidak dapat dihapus.");
        await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_DRAFT_DELETED", objectType: "PURCHASE", objectId: id.toString(), beforeAfter: { before: { purchaseNumber: purchase.purchaseNumber, status: purchase.status, totalAmount: purchase.totalAmount.toString() } } });
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchase.delete({ where: { id } });
        return { ok: true as const };
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    throw error;
  }
}

export async function confirmPurchase(id: bigint, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try {
    return await executeIdempotent({
      actor, operation: "purchase.confirm", key, payload: { id: id.toString() },
      transaction,
      run: async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
        const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: { orderBy: { lineNumber: "asc" } } } });
        if (!purchase) throw new PurchaseServiceError("NOT_FOUND", "Purchase tidak ditemukan.");
        if (purchase.status !== "DRAFT") throw new PurchaseServiceError("STATE_CONFLICT", "Hanya Purchase Draft yang dapat dikonfirmasi.");
        if (!purchase.items.length) throw new PurchaseServiceError("INVALID", "Purchase harus memiliki minimal satu item.");
        assertValidTransactionAt(purchase.transactionAt);

        const orderedItems = [...purchase.items].sort((a, b) => a.sparePartId < b.sparePartId ? -1 : a.sparePartId > b.sparePartId ? 1 : 0);
        for (const item of orderedItems) {
          const [locked] = await tx.$queryRaw<Array<{ is_active: boolean; deleted_at: Date | null }>>`SELECT is_active, deleted_at FROM spare_parts WHERE id = ${item.sparePartId} FOR UPDATE`;
          if (!locked || !locked.is_active || locked.deleted_at) throw new PurchaseServiceError("INVALID", "Sparepart tidak aktif atau tidak ditemukan.");
          await applyStockMovement(tx, {
            sparePartId: item.sparePartId,
            movementType: "PURCHASE_RECEIPT",
            quantity: item.quantity,
            unitCost: item.unitBuyPrice,
            sourceType: "PURCHASE",
            sourceId: purchase.id.toString(),
            actorId: actor.id,
          });
          await tx.sparePart.update({ where: { id: item.sparePartId }, data: { latestBuyPrice: item.unitBuyPrice } });
        }

        const confirmedAt = new Date();
        const completed = await tx.purchase.update({ where: { id }, data: { status: "COMPLETED", confirmedAt }, include: purchaseInclude });
        await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_CONFIRMED", objectType: "PURCHASE", objectId: id.toString(), beforeAfter: { before: { status: purchase.status, totalAmount: purchase.totalAmount.toString() }, after: { status: completed.status, confirmedAt: completed.confirmedAt?.toISOString(), totalAmount: completed.totalAmount.toString(), items: completed.items.map((item) => ({ code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), unitBuyPrice: item.unitBuyPrice.toString() })) } } });
        return fullPurchaseDto(completed);
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) {
      throw new PurchaseServiceError("INSUFFICIENT_STOCK", error.message);
    }
    throw error;
  }
}

export async function updateCompletedPurchase(id: bigint, input: DraftInput & { reason?: string }, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  assertValidTransactionAt(input.transactionAt);
  if (input.supplierName.length > 200) throw new PurchaseServiceError("INVALID", "Nama supplier terlalu panjang.");
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 1000) throw new PurchaseServiceError("INVALID", "Alasan terlalu panjang.");
  try {
    return await executeIdempotent({
      actor, operation: "purchase.update-completed", key, transaction,
      payload: { id: id.toString(), transactionAt: input.transactionAt, supplierName: input.supplierName, items: input.items, reason },
      run: async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
        const before = await tx.purchase.findUnique({ where: { id }, include: purchaseInclude });
        if (!before) throw new PurchaseServiceError("NOT_FOUND", "Purchase tidak ditemukan.");
        if (before.status !== "COMPLETED") throw new PurchaseServiceError("STATE_CONFLICT", "Hanya Purchase Completed yang dapat diedit.");
        if (before.editCount >= 1) throw new PurchaseServiceError("STATE_CONFLICT", "Purchase Completed hanya dapat diedit satu kali.");

        const previousLines = before.items.map((item) => ({ sparePartId: item.sparePartId, quantity: item.quantity, unitBuyPrice: item.unitBuyPrice }));
        const canonical = (lines: PurchaseLineInput[]) => lines.map((line) => ({ sparePartId: line.sparePartId.toString(), quantity: line.quantity.toString(), unitBuyPrice: line.unitBuyPrice.toString() })).sort((a, b) => a.sparePartId.localeCompare(b.sparePartId));
        const itemsUnchanged = JSON.stringify(canonical(previousLines)) === JSON.stringify(canonical(input.items));
        const dateUnchanged = before.transactionAt.getTime() === input.transactionAt.getTime();
        const supplierUnchanged = before.supplierName === input.supplierName;
        if (itemsUnchanged && dateUnchanged && supplierUnchanged) throw new PurchaseServiceError("INVALID", "Tidak ada perubahan pada Purchase.");
        const supplierOnly = itemsUnchanged && dateUnchanged && !supplierUnchanged;
        if (!supplierOnly && !reason) throw new PurchaseServiceError("INVALID", "Alasan wajib diisi untuk perubahan selain supplier saja.");

        const allPartIds = [...previousLines.map((line) => line.sparePartId), ...input.items.map((line) => line.sparePartId)];
        await lockParts(tx, allPartIds);
        if (!supplierOnly) await rejectIfPurchaseStockWasUsed(tx, before, allPartIds);
        const parts = await readActiveParts(tx, input.items);
        const prepared = makeItems(input.items, parts, false);

        const oldByPart = new Map(before.items.map((item) => [item.sparePartId.toString(), item]));
        const newByPart = new Map(prepared.items.map((item) => [item.sparePartId.toString(), item]));
        const affectedIds = [...new Set([...oldByPart.keys(), ...newByPart.keys()])].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const correctionMovementByPart = new Map<string, bigint>();
        if (!supplierOnly) {
          for (const sparePartId of affectedIds) {
            const oldLine = oldByPart.get(sparePartId.toString());
            const newLine = newByPart.get(sparePartId.toString());
            const oldQuantity = oldLine?.quantity ?? 0n;
            const oldValue = oldLine?.lineAmount ?? 0n;
            const newQuantity = newLine?.quantity ?? 0n;
            const newValue = newLine?.lineAmount ?? 0n;
            if (oldQuantity === newQuantity && oldValue === newValue) continue;
            const originalMovement = await tx.stockMovement.findFirst({
              where: { sparePartId, sourceType: "PURCHASE", sourceId: id.toString(), movementType: "PURCHASE_RECEIPT", quantity: { gt: 0n } },
              orderBy: { id: "asc" }, select: { id: true },
            });
            const applied = await applyPurchaseInventoryDelta(tx, {
              sparePartId,
              quantityDelta: newQuantity - oldQuantity,
              purchaseValueDelta: newValue - oldValue,
              sourceType: "PURCHASE_EDIT",
              sourceId: id.toString(),
              actorId: actor.id,
              reversalOfId: originalMovement?.id,
            });
            if (applied && newLine) correctionMovementByPart.set(sparePartId.toString(), applied.movement.id);
          }
        }

        const updated = await tx.purchase.update({
          where: { id },
          data: {
            transactionAt: input.transactionAt,
            supplierName: input.supplierName,
            totalAmount: prepared.totalAmount,
            editCount: { increment: 1 },
            ...(supplierOnly ? {} : {
              items: {
                deleteMany: {},
                create: prepared.items.map((item) => ({
                  sparePartId: item.sparePartId, lineNumber: item.lineNumber,
                  partCodeSnapshot: item.partCodeSnapshot, partNameSnapshot: item.partNameSnapshot,
                  quantity: item.quantity, unitBuyPrice: item.unitBuyPrice, lineAmount: item.lineAmount,
                })),
              },
            }),
          }, include: purchaseInclude,
        });
        await writeAudit(tx, {
          actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_COMPLETED_EDITED",
          objectType: "PURCHASE", objectId: id.toString(),
          beforeAfter: { reason: supplierOnly ? null : reason, before: auditPurchaseValues(before), after: auditPurchaseValues(updated) },
        });
        if (!supplierOnly) await refreshLatestBuyPrices(tx, affectedIds);
        return fullPurchaseDto(updated);
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) {
      throw new PurchaseServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    }
    throw error;
  }
}

export async function cancelPurchase(id: bigint, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  try {
    return await executeIdempotent({
      actor, operation: "purchase.cancel", key, transaction, payload: { id: id.toString() },
      run: async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
        const purchase = await tx.purchase.findUnique({ where: { id }, include: purchaseInclude });
        if (!purchase) throw new PurchaseServiceError("NOT_FOUND", "Purchase tidak ditemukan.");
        if (purchase.status !== "COMPLETED") throw new PurchaseServiceError("STATE_CONFLICT", "Hanya Purchase Completed yang dapat dibatalkan.");
        const purchaseMovements = await tx.stockMovement.findMany({
          where: { sourceId: id.toString(), sourceType: { in: ["PURCHASE", "PURCHASE_EDIT"] } },
          orderBy: { id: "asc" },
        });
        const partIds = [...new Set(purchaseMovements.map((movement) => movement.sparePartId))];
        await lockParts(tx, partIds);
        await rejectIfPurchaseStockWasUsed(tx, purchase, partIds);

        const netByPart = new Map<string, { quantity: bigint; purchaseValue: bigint; valuation: bigint; reversalOfId?: bigint }>();
        for (const movement of purchaseMovements) {
          const entry = netByPart.get(movement.sparePartId.toString()) ?? { quantity: 0n, purchaseValue: 0n, valuation: 0n };
          entry.quantity += movement.quantity;
          entry.purchaseValue += movement.purchaseValueDelta ?? 0n;
          entry.valuation += movement.valuationDelta ?? 0n;
          if (entry.reversalOfId === undefined && movement.movementType === "PURCHASE_RECEIPT" && movement.quantity > 0n) entry.reversalOfId = movement.id;
          netByPart.set(movement.sparePartId.toString(), entry);
        }
        for (const [partIdText, net] of netByPart) {
          if (net.quantity === 0n && net.purchaseValue === 0n && net.valuation === 0n) continue;
          await applyPurchaseInventoryDelta(tx, {
            sparePartId: BigInt(partIdText),
            quantityDelta: -net.quantity,
            purchaseValueDelta: -net.purchaseValue,
            valuationBasisDelta: -net.valuation,
            sourceType: "PURCHASE_CANCEL",
            sourceId: id.toString(),
            actorId: actor.id,
            reversalOfId: net.reversalOfId,
          });
        }
        const canceled = await tx.purchase.update({ where: { id }, data: { status: "CANCELED" }, include: purchaseInclude });
        await refreshLatestBuyPrices(tx, partIds);
        await writeAudit(tx, {
          actorId: actor.id, actorUsername: actor.username, action: "PURCHASE_CANCELED",
          objectType: "PURCHASE", objectId: id.toString(),
          beforeAfter: { before: auditPurchaseValues(purchase), after: auditPurchaseValues(canceled) },
        });
        return fullPurchaseDto(canceled);
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new PurchaseServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) {
      throw new PurchaseServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    }
    throw error;
  }
}
