import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { applyStockDelta, applyStockMovement, StockServiceError } from "@/server/stock-service";
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

function mapService(row: { id: bigint; serviceNumber: string; transactionAt: Date; vehicleDescription: string | null; status: string; editCount: number; createdById: bigint; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; jobs: Array<{ lineNumber: number; description: string; amount: bigint }>; items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }, role: "ADMIN" | "USER") {
  return {
    id: row.id.toString(), serviceNumber: row.serviceNumber, transactionAt: row.transactionAt.toISOString(), transactionInput: workshopDateTimeInput(row.transactionAt), transactionDisplay: workshopDateTimeDisplay(row.transactionAt), vehicleDescription: row.vehicleDescription, status: row.status, ...(role === "ADMIN" ? { editCount: row.editCount } : {}),
    jobs: [...row.jobs].sort((a, b) => a.lineNumber - b.lineNumber).map((job) => ({ lineNumber: job.lineNumber, description: job.description, amount: job.amount.toString() })),
    items: [...row.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => ({ sparePartId: item.sparePartId.toString(), lineNumber: item.lineNumber, code: item.partCodeSnapshot, name: item.partNameSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), ...(role === "ADMIN" ? { unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() } : {}) })),
    subtotal: row.subtotal.toString(), discount: row.discount.toString(), totalAmount: row.totalAmount.toString(), ...(role === "ADMIN" ? { totalHpp: row.totalHpp.toString(), createdById: row.createdById.toString() } : {}),
  };
}

const serviceInclude = { jobs: true, items: true } as const;

async function createServiceRevision(tx: Prisma.TransactionClient, service: { id: bigint; transactionAt: Date; vehicleDescription: string | null; status: "COMPLETED" | "CANCELED"; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; createdById: bigint }, actorId: bigint, revisionNumber: number, jobs: Array<{ lineNumber: number; description: string; amount: bigint }>, items: Array<{ lineNumber: number; sparePartId: bigint; partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }>) {
  return tx.serviceRevision.create({ data: { serviceId: service.id, revisionNumber, transactionAt: service.transactionAt, vehicleDescription: service.vehicleDescription, status: service.status, subtotal: service.subtotal, discount: service.discount, totalAmount: service.totalAmount, totalHpp: service.totalHpp, createdById: actorId, jobs: { create: jobs.map((job) => ({ lineNumber: job.lineNumber, description: job.description, amount: job.amount })) }, items: { create: items.map((item) => ({ sparePartId: item.sparePartId, lineNumber: item.lineNumber, partCodeSnapshot: item.partCodeSnapshot, partNameSnapshot: item.partNameSnapshot, quantity: item.quantity, sellingPrice: item.sellingPrice, lineAmount: item.lineAmount, unitHppSnapshot: item.unitHppSnapshot, lineHpp: item.lineHpp })) } } });
}

function auditServiceValues(service: { serviceNumber: string; transactionAt: Date; vehicleDescription: string | null; status: string; subtotal: bigint; discount: bigint; totalAmount: bigint; totalHpp: bigint; jobs: Array<{ description: string; amount: bigint }>; items: Array<{ partCodeSnapshot: string; partNameSnapshot: string; quantity: bigint; sellingPrice: bigint; lineAmount: bigint; unitHppSnapshot: bigint; lineHpp: bigint }> }) {
  return { serviceNumber: service.serviceNumber, transactionAt: service.transactionAt.toISOString(), vehicleDescription: service.vehicleDescription, status: service.status, subtotal: service.subtotal.toString(), discount: service.discount.toString(), totalAmount: service.totalAmount.toString(), totalHpp: service.totalHpp.toString(), jobs: service.jobs.map((job) => ({ description: job.description, amount: job.amount.toString() })), items: service.items.map((item) => ({ code: item.partCodeSnapshot, quantity: item.quantity.toString(), sellingPrice: item.sellingPrice.toString(), lineAmount: item.lineAmount.toString(), unitHppSnapshot: item.unitHppSnapshot.toString(), lineHpp: item.lineHpp.toString() })) };
}

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
        const stock = await applyStockMovement(tx, { sparePartId: part.id, movementType: "SERVICE_ISSUE", quantity: -item.quantity, unitCost: part.averageCost!, sourceType: "SERVICE", sourceId: created.id.toString(), sourceRevision: 0, sourceOperation: "CREATE", actorId: actor.id });
        await tx.serviceItem.create({ data: { serviceId: created.id, sparePartId: part.id, lineNumber: input.items.indexOf(item) + 1, partCodeSnapshot: part.code, partNameSnapshot: part.name, quantity: item.quantity, sellingPrice, lineAmount: item.quantity * sellingPrice, unitHppSnapshot: stock.unitCost, lineHpp: item.quantity * stock.unitCost } });
      }
      const complete = await tx.service.findUniqueOrThrow({ where: { id: created.id }, include: serviceInclude });
      await createServiceRevision(tx, complete, actor.id, 0, complete.jobs, complete.items);
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SERVICE_CREATED", objectType: "SERVICE", objectId: created.id.toString(), beforeAfter: { after: { serviceNumber, status: "COMPLETED", transactionAt: input.transactionAt.toISOString(), vehicleDescription: calculated.vehicleDescription, jobs: calculated.jobs, items: calculated.items, subtotal: calculated.subtotal, discount: calculated.discount, totalAmount: calculated.totalAmount, totalHpp: complete.totalHpp.toString() } } });
      return mapService(complete, role);
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new ServiceServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new ServiceServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function updateCompletedService(id: bigint, input: ServiceInput & { reason: string }, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  validateInput(input);
  const reason = input.reason.trim();
  if (!reason) throw new ServiceServiceError("INVALID", "Alasan edit wajib diisi.");
  try {
    return await executeIdempotent({ actor, operation: "service.update-completed", key, transaction, payload: { id: id.toString(), input: { ...input, transactionAt: input.transactionAt.toISOString(), reason } }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM services WHERE id = ${id} FOR UPDATE`;
      const before = await tx.service.findUnique({ where: { id }, include: serviceInclude });
      if (!before) throw new ServiceServiceError("NOT_FOUND", "Service tidak ditemukan.");
      if (before.status !== "COMPLETED" || before.editCount >= 1) throw new ServiceServiceError("STATE_CONFLICT", "Service Completed hanya dapat diedit satu kali.");
      const revision0 = await tx.serviceRevision.findUnique({ where: { serviceId_revisionNumber: { serviceId: id, revisionNumber: 0 } }, include: { jobs: true, items: true } });
      if (!revision0 || await tx.serviceRevision.findUnique({ where: { serviceId_revisionNumber: { serviceId: id, revisionNumber: 1 } } })) throw new ServiceServiceError("STATE_CONFLICT", "Revision Service tidak valid untuk edit.");
      const ids = [...new Set([...before.items.map((item) => item.sparePartId), ...input.items.map((item) => item.sparePartId)])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const partId of ids) await tx.$queryRaw`SELECT id FROM spare_parts WHERE id = ${partId} FOR UPDATE`;
      const parts = await readParts(tx, input.items);
      const calculated = calculate(input, parts, "ADMIN") as ReturnType<typeof calculate> & { totalHpp: string; items: Array<{ sparePartId: string; lineNumber: number; code: string; name: string; quantity: string; sellingPrice: string; lineAmount: string; unitHppSnapshot: string; lineHpp: string }> };
      const oldByPart = new Map(revision0.items.map((item) => [item.sparePartId.toString(), item]));
      const newByPart = new Map(input.items.map((item) => [item.sparePartId.toString(), item]));
      for (const partId of ids) {
        const oldQuantity = oldByPart.get(partId.toString())?.quantity ?? 0n;
        const newQuantity = newByPart.get(partId.toString())?.quantity ?? 0n;
        const delta = oldQuantity - newQuantity;
        if (delta !== 0n) await applyStockDelta(tx, { sparePartId: partId, quantityDelta: delta, movementType: "CORRECTION", sourceType: "SERVICE", sourceId: id.toString(), sourceRevision: 1, sourceOperation: "EDIT", actorId: actor.id, unitCost: newByPart.get(partId.toString()) ? parts.find((part) => part.id === partId)?.averageCost ?? undefined : oldByPart.get(partId.toString())?.unitHppSnapshot });
      }
      const updated = await tx.service.update({ where: { id }, data: { transactionAt: input.transactionAt, vehicleDescription: calculated.vehicleDescription as string | null, subtotal: BigInt(calculated.subtotal), discount: BigInt(calculated.discount), totalAmount: BigInt(calculated.totalAmount), totalHpp: BigInt(calculated.totalHpp!), editCount: 1, jobs: { deleteMany: {}, create: input.jobs.map((job, index) => ({ lineNumber: index + 1, description: job.description.trim(), amount: job.amount })) }, items: { deleteMany: {}, create: calculated.items.map((item) => { const sensitive = item as typeof item & { unitHppSnapshot: string; lineHpp: string }; return { sparePartId: BigInt(item.sparePartId), lineNumber: Number(item.lineNumber), partCodeSnapshot: String(item.code), partNameSnapshot: String(item.name), quantity: BigInt(item.quantity), sellingPrice: BigInt(item.sellingPrice), lineAmount: BigInt(item.lineAmount), unitHppSnapshot: BigInt(sensitive.unitHppSnapshot), lineHpp: BigInt(sensitive.lineHpp) }; }) } }, include: serviceInclude });
      await createServiceRevision(tx, updated, actor.id, 1, updated.jobs, updated.items);
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SERVICE_COMPLETED_EDITED", objectType: "SERVICE", objectId: id.toString(), beforeAfter: { reason, before: auditServiceValues(before), after: auditServiceValues(updated) } });
      return mapService(updated, "ADMIN");
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new ServiceServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID", error.message);
    if (error instanceof StockServiceError) throw new ServiceServiceError(error.kind === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : "STATE_CONFLICT", error.message);
    throw error;
  }
}

export async function cancelService(id: bigint, reasonInput: string, actor: Actor, key: string, transaction?: Prisma.TransactionClient) {
  const reason = reasonInput.trim();
  if (!reason) throw new ServiceServiceError("INVALID", "Alasan pembatalan wajib diisi.");
  try {
    return await executeIdempotent({ actor, operation: "service.cancel", key, transaction, payload: { id: id.toString(), reason }, run: async (tx) => {
      await tx.$queryRaw`SELECT id FROM services WHERE id = ${id} FOR UPDATE`;
      const service = await tx.service.findUnique({ where: { id }, include: serviceInclude });
      if (!service) throw new ServiceServiceError("NOT_FOUND", "Service tidak ditemukan.");
      if (service.status !== "COMPLETED") throw new ServiceServiceError("STATE_CONFLICT", "Service sudah dibatalkan atau tidak dapat dibatalkan.");
      const revision = await tx.serviceRevision.findFirst({ where: { serviceId: id }, orderBy: { revisionNumber: "desc" }, include: { items: true } });
      if (!revision) throw new ServiceServiceError("STATE_CONFLICT", "Revision Service tidak tersedia.");
      const movements = await tx.stockMovement.findMany({ where: { sourceType: "SERVICE", sourceId: id.toString(), movementType: { in: ["SERVICE_ISSUE", "CORRECTION"] } }, orderBy: { id: "asc" } });
      const net = new Map<string, bigint>();
      for (const movement of movements) net.set(movement.sparePartId.toString(), (net.get(movement.sparePartId.toString()) ?? 0n) + movement.quantity);
      for (const [partId, quantity] of net) if (quantity !== 0n) {
        const item = revision.items.find((candidate) => candidate.sparePartId.toString() === partId);
        const original = movements.find((movement) => movement.sparePartId.toString() === partId && movement.movementType === "SERVICE_ISSUE");
        await applyStockDelta(tx, { sparePartId: BigInt(partId), quantityDelta: -quantity, movementType: "REVERSAL", sourceType: "SERVICE", sourceId: id.toString(), sourceRevision: revision.revisionNumber, sourceOperation: "CANCEL", actorId: actor.id, unitCost: item?.unitHppSnapshot, reversalOfId: original?.id });
      }
      const canceled = await tx.service.update({ where: { id }, data: { status: "CANCELED" }, include: serviceInclude });
      await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "SERVICE_CANCELED", objectType: "SERVICE", objectId: id.toString(), beforeAfter: { reason, before: auditServiceValues(service), after: auditServiceValues(canceled) } });
      return mapService(canceled, "ADMIN");
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
