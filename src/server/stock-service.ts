import "server-only";
import type { Prisma, StockMovementType } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";

type Actor = { id: bigint; username: string };
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MIN_BIGINT = -9_223_372_036_854_775_808n;

export class StockServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "INVALID" | "INSUFFICIENT_STOCK" | "STATE_CONFLICT" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
    this.name = "StockServiceError";
  }
}

const inbound = new Set<StockMovementType>(["OPENING_STOCK", "PURCHASE_RECEIPT", "ADJUSTMENT_IN"]);
const outbound = new Set<StockMovementType>(["SERVICE_ISSUE", "SLS_ISSUE", "ADJUSTMENT_OUT"]);

function roundedAverage(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new StockServiceError("INVALID", "Jumlah stok untuk perhitungan biaya tidak valid.");
  return (numerator + denominator / 2n) / denominator;
}

async function lockSparePart(tx: Prisma.TransactionClient, sparePartId: bigint) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM spare_parts WHERE id = ${sparePartId} FOR UPDATE`;
  if (!rows.length) throw new StockServiceError("NOT_FOUND", "Sparepart tidak ditemukan.");
  return tx.sparePart.findUniqueOrThrow({ where: { id: sparePartId } });
}

export async function applyStockMovement(tx: Prisma.TransactionClient, input: {
  sparePartId: bigint;
  movementType: StockMovementType;
  quantity: bigint;
  unitCost?: bigint;
  sourceType: string;
  sourceId: string;
  actorId: bigint;
  reversalOfId?: bigint;
}) {
  if (input.quantity === 0n || input.quantity < MIN_BIGINT || input.quantity > MAX_BIGINT || input.sourceType.length > 80 || input.sourceId.length > 200) {
    throw new StockServiceError("INVALID", "Data pergerakan stok tidak valid.");
  }
  if (inbound.has(input.movementType) && input.quantity <= 0n) {
    throw new StockServiceError("INVALID", "Penambahan stok harus memiliki jumlah positif.");
  }
  if (outbound.has(input.movementType) && input.quantity >= 0n) {
    throw new StockServiceError("INVALID", "Pengurangan stok harus memiliki jumlah negatif.");
  }

  const part = await lockSparePart(tx, input.sparePartId);
  const newStock = part.stockOnHand + input.quantity;
  if (newStock > MAX_BIGINT) throw new StockServiceError("INVALID", "Jumlah stok di luar batas penyimpanan.");
  if (newStock < 0n) throw new StockServiceError("INSUFFICIENT_STOCK", "Stok tidak mencukupi.");

  let movementUnitCost: bigint;
  let nextAverageCost = part.averageCost;
  const beforeValue = part.stockOnHand * (part.averageCost ?? 0n);
  if (input.quantity > 0n) {
    const receiptCost = input.unitCost;
    if (receiptCost === undefined || receiptCost <= 0n || receiptCost > MAX_BIGINT) {
      throw new StockServiceError("INVALID", "Biaya per barang harus lebih dari Rp0.");
    }
    movementUnitCost = receiptCost;
    const currentCost = part.averageCost;
    if (part.stockOnHand === 0n) nextAverageCost = receiptCost;
    else {
      if (currentCost === null) throw new StockServiceError("STATE_CONFLICT", "Average Cost belum tersedia untuk stok yang sudah ada.");
      const totalValue = part.stockOnHand * currentCost + input.quantity * receiptCost;
      nextAverageCost = roundedAverage(totalValue, newStock);
    }
  } else {
    if (input.unitCost !== undefined && (input.unitCost <= 0n || input.unitCost > MAX_BIGINT)) {
      throw new StockServiceError("INVALID", "Biaya per barang tidak valid.");
    }
    const currentCost = part.averageCost;
    if (currentCost === null) throw new StockServiceError("STATE_CONFLICT", "Average Cost belum tersedia untuk stok yang akan dikeluarkan.");
    movementUnitCost = input.unitCost ?? currentCost;
  }

  const afterValue = newStock * (nextAverageCost ?? 0n);
  const valuationDelta = afterValue - beforeValue;
  if (afterValue > MAX_BIGINT || valuationDelta < MIN_BIGINT || valuationDelta > MAX_BIGINT) {
    throw new StockServiceError("INVALID", "Nilai persediaan di luar batas penyimpanan.");
  }

  await tx.sparePart.update({
    where: { id: part.id },
    data: {
      stockOnHand: { increment: input.quantity },
      ...(input.quantity > 0n ? { averageCost: nextAverageCost! } : {}),
    },
  });
  const movement = await tx.stockMovement.create({
    data: {
      sparePartId: part.id,
      movementType: input.movementType,
      quantity: input.quantity,
      unitCost: movementUnitCost,
      valuationDelta,
      ...(input.sourceType === "PURCHASE" && input.quantity > 0n
        ? { purchaseValueDelta: input.quantity * movementUnitCost }
        : {}),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      actorId: input.actorId,
      occurredAt: new Date(),
      reversalOfId: input.reversalOfId,
    },
  });
  return {
    movement,
    currentStock: newStock,
    averageCost: nextAverageCost,
    unitCost: movementUnitCost,
  };
}

export async function applyPurchaseInventoryDelta(tx: Prisma.TransactionClient, input: {
  sparePartId: bigint;
  quantityDelta: bigint;
  purchaseValueDelta: bigint;
  valuationBasisDelta?: bigint;
  sourceType: "PURCHASE_EDIT" | "PURCHASE_CANCEL";
  sourceId: string;
  actorId: bigint;
  reversalOfId?: bigint;
}) {
  if (input.quantityDelta < MIN_BIGINT || input.quantityDelta > MAX_BIGINT || input.purchaseValueDelta < MIN_BIGINT || input.purchaseValueDelta > MAX_BIGINT) {
    throw new StockServiceError("INVALID", "Perubahan stok atau nilai persediaan di luar batas penyimpanan.");
  }
  if (input.quantityDelta === 0n && input.purchaseValueDelta === 0n) return null;
  const part = await lockSparePart(tx, input.sparePartId);
  const nextStock = part.stockOnHand + input.quantityDelta;
  if (nextStock < 0n) throw new StockServiceError("INSUFFICIENT_STOCK", "Koreksi Purchase akan membuat stok negatif.");
  if (nextStock > MAX_BIGINT) throw new StockServiceError("INVALID", "Jumlah stok di luar batas penyimpanan.");

  const beforeValue = part.stockOnHand * (part.averageCost ?? 0n);
  const targetValue = beforeValue + (input.valuationBasisDelta ?? input.purchaseValueDelta);
  if (targetValue < 0n || targetValue > MAX_BIGINT) {
    throw new StockServiceError("STATE_CONFLICT", "Koreksi menghasilkan nilai persediaan yang tidak valid.");
  }
  let nextAverageCost: bigint | null;
  if (nextStock === 0n) {
    if (targetValue !== 0n) throw new StockServiceError("STATE_CONFLICT", "Nilai persediaan harus nol ketika stok menjadi nol.");
    nextAverageCost = null;
  } else {
    nextAverageCost = roundedAverage(targetValue, nextStock);
    if (nextAverageCost <= 0n || nextAverageCost > MAX_BIGINT) {
      throw new StockServiceError("STATE_CONFLICT", "Average Cost hasil koreksi tidak valid.");
    }
  }
  const afterValue = nextStock * (nextAverageCost ?? 0n);
  const valuationDelta = afterValue - beforeValue;
  if (afterValue > MAX_BIGINT || valuationDelta < MIN_BIGINT || valuationDelta > MAX_BIGINT) {
    throw new StockServiceError("INVALID", "Nilai persediaan di luar batas penyimpanan.");
  }

  await tx.sparePart.update({ where: { id: part.id }, data: { stockOnHand: nextStock, averageCost: nextAverageCost } });
  const movement = await tx.stockMovement.create({
    data: {
      sparePartId: part.id,
      movementType: input.sourceType === "PURCHASE_CANCEL" ? "REVERSAL" : "CORRECTION",
      quantity: input.quantityDelta,
      unitCost: null,
      valuationDelta,
      purchaseValueDelta: input.purchaseValueDelta,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      actorId: input.actorId,
      occurredAt: new Date(),
      reversalOfId: input.reversalOfId,
    },
  });
  return { movement, currentStock: nextStock, averageCost: nextAverageCost, inventoryValue: afterValue };
}

export async function recordOpeningStock(input: {
  sparePartId: bigint;
  quantity: bigint;
  unitCost: bigint;
  key: string;
}, actor: Actor) {
  try {
    return await executeIdempotent({
      actor,
      operation: "stock.opening",
      key: input.key,
      payload: { sparePartId: input.sparePartId.toString(), quantity: input.quantity.toString(), unitCost: input.unitCost.toString() },
      run: async (tx) => {
        const part = await lockSparePart(tx, input.sparePartId);
        if (part.deletedAt || !part.isActive) throw new StockServiceError("STATE_CONFLICT", "Sparepart tidak aktif.");
        const result = await applyStockMovement(tx, {
          sparePartId: part.id,
          movementType: "OPENING_STOCK",
          quantity: input.quantity,
          unitCost: input.unitCost,
          sourceType: "OPENING_STOCK",
          sourceId: input.key,
          actorId: actor.id,
        });
        await writeAudit(tx, {
          actorId: actor.id,
          actorUsername: actor.username,
          action: "OPENING_STOCK_RECORDED",
          objectType: "SPAREPART",
          objectId: part.id.toString(),
          beforeAfter: {
            before: { currentStock: part.stockOnHand.toString(), averageCost: part.averageCost?.toString() ?? null },
            after: { currentStock: result.currentStock.toString(), averageCost: result.averageCost?.toString() ?? null },
          },
        });
        return {
          movementId: result.movement.id.toString(),
          sparePartId: part.id.toString(),
          code: part.code,
          quantityAdded: input.quantity.toString(),
          currentStock: result.currentStock.toString(),
          averageCost: result.averageCost?.toString() ?? null,
        };
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new StockServiceError("IDEMPOTENCY_CONFLICT", error.message);
    throw error;
  }
}

export async function listMovementsForAdmin(sparePartId?: bigint, limit = 100, transaction?: Prisma.TransactionClient) {
  const repository = transaction ?? prisma;
  const movements = await repository.stockMovement.findMany({
    where: sparePartId === undefined ? undefined : { sparePartId },
    take: Math.min(Math.max(limit, 1), 200),
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    include: { sparePart: { select: { code: true, name: true } } },
  });
  return movements.map((movement) => ({
    id: movement.id.toString(),
    sparePartId: movement.sparePartId.toString(),
    code: movement.sparePart.code,
    name: movement.sparePart.name,
    type: movement.movementType,
    quantity: movement.quantity.toString(),
    unitCost: movement.unitCost?.toString() ?? null,
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    occurredAt: movement.occurredAt.toISOString(),
    valuationDelta: movement.valuationDelta?.toString() ?? null,
    purchaseValueDelta: movement.purchaseValueDelta?.toString() ?? null,
  }));
}
