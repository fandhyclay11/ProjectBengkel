import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { applyStockMovement, StockServiceError } from "@/server/stock-service";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";
import { workshopDateKey, workshopDateTimeDisplay, workshopDateTimeInput } from "@/server/datetime";

const MAX_BIGINT = 9_223_372_036_854_775_807n;
type Actor = { id: bigint; username: string };
type JobInput = { description: string; amount: bigint };
type ItemInput = { sparePartId: bigint; quantity: bigint; sellingPrice?: bigint };
export type ServiceInput = { transactionAt: Date; vehicleDescription?: string; discount: bigint; jobs: JobInput[]; items: ItemInput[] };

export class ServiceServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "INVALID" | "FUTURE_DATE" | "INSUFFICIENT_STOCK" | "STATE_CONFLICT" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
  }
}

type Part = { id: bigint; code: string; name: string; sellingPrice: bigint; latestBuyPrice: bigint | null; averageCost: bigint | null; stockOnHand: bigint; isActive: boolean; deletedAt: Date | null };

function assertValidDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new ServiceServiceError("INVALID", "Tanggal Service tidak valid.");
  if (value.getTime() > Date.now()) throw new ServiceServiceError("FUTURE_DATE", "Tanggal transaksi tidak boleh di masa depan.");
}

function validateInput(input: ServiceInput) {
  assertValidDate(input.transactionAt);
  if (input.vehicleDescription !== undefined && input.vehicleDescription.length > 200) throw new ServiceServiceError("INVALID", "Keterangan kendaraan terlalu panjang.");
  if (!input.jobs.length) throw new ServiceServiceError("INVALID", "Service harus memiliki minimal satu pekerjaan atau jasa.");
  if (input.discount < 0n || input.discount > MAX_BIGINT) throw new ServiceServiceError("INVALID", "Discount tidak valid.");
  for (const job of input.jobs) {
    if (!job.description.trim() || job.description.length > 300 || job.amount <= 0n || job.amount > MAX_BIGINT) throw new ServiceServiceError("INVALID", "Data pekerjaan Service tidak valid.");
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    const id = item.sparePartId.toString();
    if (seen.has(id)) throw new ServiceServiceError("INVALID", "Sparepart yang sama tidak boleh muncul lebih dari sekali dalam satu Service.");
    seen.add(id);
    if (item.quantity <= 0n || item.quantity > MAX_BIGINT || (item.sellingPrice !== undefined && (item.sellingPrice <= 0n || item.sellingPrice > MAX_BIGINT))) {
      throw new ServiceServiceError("INVALID", "Jumlah dan harga jual Service harus berupa bilangan bulat lebih dari Rp0.");
    }
  }
}

async function readParts(repository: Prisma.TransactionClient | typeof prisma, items: ItemInput[]) {
  const ids = [...new Set(items.map((item) => item.sparePartId))];
  const parts = await repository.sparePart.findMany({ where: { id: { in: ids }, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true, sellingPrice: true, latestBuyPrice: true, averageCost: true, stockOnHand: true, isActive: true, deletedAt: true } });
  if (parts.length !== ids.length) throw new ServiceServiceError("INVALID", "Sparepart tidak aktif atau tidak ditemukan.");
  return parts as Part[];
}

function calculate(input: ServiceInput, parts: Part[], role: "ADMIN" | "USER") {
  const partById = new Map(parts.map((part) => [part.id.toString(), part]));
  const jobs = input.jobs.map((job, index) => ({ lineNumber: index + 1, description: job.description.trim(), amount: job.amount }));
  const items = input.items.map((item, index) => {
    const part = partById.get(item.sparePartId.toString())!;
    const sellingPrice = item.sellingPrice ?? part.sellingPrice;
    if (!part.averageCost) throw new ServiceServiceError("STATE_CONFLICT", "Average Cost belum tersedia untuk sparepart yang digunakan.");
    const lineAmount = item.quantity * sellingPrice;
    const lineHpp = item.quantity * part.averageCost;
    if (lineAmount > MAX_BIGINT || lineHpp > MAX_BIGINT) throw new ServiceServiceError("INVALID", "Nilai Service di luar batas penyimpanan.");
    return { lineNumber: index + 1, part, quantity: item.quantity, sellingPrice, lineAmount, unitHppSnapshot: part.averageCost, lineHpp, belowLatestBuyPrice: part.latestBuyPrice !== null && sellingPrice < part.latestBuyPrice };
  });
  const jobSubtotal = jobs.reduce((sum, job) => sum + job.amount, 0n);
  const partSubtotal = items.reduce((sum, item) => sum + item.lineAmount, 0n);
  const subtotal = jobSubtotal + partSubtotal;
  const totalAmount = subtotal - input.discount;
  const totalHpp = items.reduce((sum, item) => sum + item.lineHpp, 0n);
  if (subtotal > MAX_BIGINT || totalHpp > MAX_BIGINT || input.discount > subtotal || totalAmount < 0n) throw new ServiceServiceError("INVALID", "Subtotal, discount, atau total Service tidak valid.");
  const sensitive = role === "ADMIN";
  return {
    transactionAt: input.transactionAt.toISOString(), vehicleDescription: input.vehicleDescription?.trim() || null,
    jobs: jobs.map((job) => ({ lineNumber: job.lineNumber, description: job.description, amount: job.amount.toString() })),
    items: items.map((item) => ({ sparePartId: item.part.id.toString(), lineNumber: item.lineNumber, code: item.part.code, name: item.part.name, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), ...(sensitive ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString(), belowLatestBuyPrice: item.belowLatestBuyPrice } : { belowLatestBuyPrice: item.belowLatestBuyPrice }) })),
    subtotal: subtotal.toString(), discount: input.discount.toString(), totalAmount: totalAmount.toString(), ...(sensitive ? { totalHpp: totalHpp.toString() } : {}),
  };
}

function numberFor(date: Date, value: bigint) {
  return `SRV-${workshopDateKey(date)}-${value.toString().padStart(4, "0")}`;
}

async function nextServiceNumber(tx: Prisma.TransactionClient, date: Date) {
  const dateKey = workshopDateKey(date);
  const [row] = await tx.$queryRaw<Array<{ last_number: bigint }>>`
    INSERT INTO document_number_counters (series, business_date, last_number)
    VALUES ('SRV', ${dateKey}, 1)
    ON CONFLICT (series, business_date)
    DO UPDATE SET last_number = document_number_counters.last_number + 1
    RETURNING last_number
  `;
  return numberFor(date, row!.last_number);
}

function mapService(row: { id: bigint; serviceNumber: string; transactionAt: Date; vehicleDescription: string | null; status: string; createdById: bigint; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; jobs: Array<{ lineNumber: number; description: string; amount: bigint }>; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), serviceNumber: row.serviceNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), vehicleDescription: row.vehicleDescription, status: row.status,
    jobs: [...row.jobs].sort((a, b) => a.lineNumber - b.lineNumber).map((job) => ({ lineNumber: job.lineNumber, description: job.description, amount: job.amount.toString() })),
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber, code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), ...(role === "ADMIN" ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() } : {}) })),
    subtotal: row.subtotal.toString(), discount: row.discount.toString(), totalAmount: row.totalAmount.toString(), ...(role === "ADMIN" ? { totalHpp: row.totalHpp.toString(), createdById: row.createdById.toString() } : {}),
  };
}

const serviceInclude = { jobs: true, items: true } as const;

export async function previewService(input: ServiceInput, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateInput(input);
  const parts = await readParts(transaction ?? prisma, input.items);
  return calculate(input, parts, role);
}

export async function createService(input: ServiceInput, actor: Actor, key: string, role: "ADMIN" | "USER", transaction?: Prisma.TransactionClient) {
  validateInput(input);
  try {
    return await executeIdempotent({ actor, operation: "service.create", key, transaction, payload: { ...input, transactionAt: input.transactionAt.toISOString(), jobs: input.jobs, items: input.items }, run: async (tx) => {
      const ids = [...new Set(input.items.map((item) => item.sparePartId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const id of ids) {
        const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM spare_parts WHERE id = ${id} FOR UPDATE`;
        if (!rows.length) throw new ServiceServiceError("INVALID", "Sparepart tidak ditemukan.");
      }
      const parts = await readParts(tx, input.items);
      const calculated = calculate(input, parts, role);
      const adminCalculated = role === "ADMIN" ? calculated : calculate(input, parts, "ADMIN");
      const serviceNumber = await nextServiceNumber(tx, input.transactionAt);
      const created = await tx.service.create({ data: { serviceNumber, transactionAt: input.transactionAt, vehicleDescription: calculated.vehicleDescription, status: "COMPLETED", createdById: actor.id, subtotal: BigInt(calculated.subtotal), discount: BigInt(calculated.discount), totalAmount: BigInt(calculated.totalAmount), totalHpp: BigInt(adminCalculated.totalHpp!), jobs: { create: input.jobs.map((job, index) => ({ lineNumber: index + 1, description: job.description.trim(), amount: job.amount })) } } });
      for (const item of input.items) {
        const part = parts.find((candidate) => candidate.id === item.sparePartId)!;
        const sellingPrice = item.sellingPrice ?? part.sellingPrice;
        const stock = await applyStockMovement(tx, { sparePartId: part.id, movementType: "SERVICE_ISSUE", quantity: -item.quantity, unitCost: part.averageCost!, sourceType: "SERVICE", sourceId: created.id.toString(), actorId: actor.id });
        await tx.serviceItem.create({ data: { serviceId: created.id, sparePartId: part.id, lineNumber: input.items.indexOf(item) + 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: item.quantity, sellingPrice, lineAmount: item.quantity * sellingPrice, unitHppSnapshot: stock.unitCost, lineHpp: item.quantity * stock.unitCost } });
      }
      const complete = await tx.service.findUniqueOrThrow({ where: { id: created.id }, include: serviceInclude });
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SERVICE_CREATED", objectType: "SERVICE", objectId: created.id.toString(), beforeAfter: { after: { serviceNumber, status: "COMPLETED", transactionAt: input.transactionAt.toISOString(), vehicleDescription: calculated.vehicleDescription, jobs: calculated.jobs, items: calculated.items, subtotal: calculated.subtotal, discount: calculated.discount, totalAmount: calculated.totalAmount, totalHpp: complete.totalHpp.toString() } } });
      return mapService(complete, role);
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new ServiceServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new ServiceServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function listServices(role: "ADMIN" | "USER") {
  const rows = await prisma.service.findMany({ include: serviceInclude, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], take: 200 });
  return rows.map((row) => mapService(row, role));
}

export async function getService(id: bigint, role: "ADMIN" | "USER") {
  const row = await prisma.service.findUnique({ where: { id }, include: serviceInclude });
  return row ? mapService(row, role) : null;
}
