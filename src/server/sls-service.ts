import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { applyStockMovement, StockServiceError } from "@/server/stock-service";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";

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

function mapSls(row: { id: bigint; slsNumber: string; transactionAt: Date; status: string; createdById: bigint; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), slsNumber: row.slsNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), status: row.status,
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber, code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), ...(role === "ADMIN" ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() } : {}) })),
    subtotal: row.subtotal.toString(), discount: row.discount.toString(), totalAmount: row.totalAmount.toString(), ...(role === "ADMIN" ? { totalHpp: row.totalHpp.toString(), createdById: row.createdById.toString() } : {}),
  };
}

const slsInclude = { items: true } as const;

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
        const stock = await applyStockMovement(tx, { sparePartId: part.id, movementType: "SLS_ISSUE", quantity: -item.quantity, unitCost: part.averageCost!, sourceType: "SLS", sourceId: created.id.toString(), actorId: actor.id });
        await tx.slsItem.create({ data: { slsId: created.id, sparePartId: part.id, lineNumber: index + 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: item.quantity, sellingPrice, lineAmount: item.quantity * sellingPrice, unitHppSnapshot: stock.unitCost, lineHpp: item.quantity * stock.unitCost } });
      }
      const complete = await tx.sls.findUniqueOrThrow({ where: { id: created.id }, include: slsInclude });
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SLS_CREATED", objectType: "SLS", objectId: created.id.toString(), beforeAfter: { after: { slsNumber, status: "COMPLETED", transactionAt: input.transactionAt.toISOString(), items: calculated.items, subtotal: calculated.subtotal, discount: calculated.discount, totalAmount: calculated.totalAmount, totalHpp: complete.totalHpp.toString() } } });
      return mapSls(complete, role);
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SlsServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new SlsServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function listSls(role: "ADMIN" | "USER") {
  const rows = await prisma.sls.findMany({ include: slsInclude, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], take: 200 });
  return rows.map((row) => mapSls(row, role));
}

export async function getSls(id: bigint, role: "ADMIN" | "USER") {
  const row = await prisma.sls.findUnique({ where: { id }, include: slsInclude });
  return row ? mapSls(row, role) : null;
}
