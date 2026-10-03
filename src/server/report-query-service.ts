import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { workshopDateKey, workshopDateRange, type WorkshopDateRange } from "@/server/datetime";

type Role = "ADMIN" | "USER";
type PageInput = { page?: number; pageSize?: number };
type DateInput = { from: string; to: string };
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MAX_PAGE_SIZE = 100;

export class ReportQueryError extends Error {
  constructor(readonly kind: "FORBIDDEN" | "INVALID", message: string) { super(message); }
}

export type FinancialSummary = {
  serviceRevenue: string;
  slsRevenue: string;
  hpp: string;
  grossProfit: string;
  expense: string;
  netProfit: string;
  serviceCount: number;
  slsCount: number;
  completedPurchaseCount: number;
  draftPurchaseCount: number;
};

export type ReportPage<T> = { rows: T[]; page: number; pageSize: number; total: number };

function requireAdmin(role: Role) {
  if (role !== "ADMIN") throw new ReportQueryError("FORBIDDEN", "Akses laporan ditolak.");
}

function range(input: DateInput): WorkshopDateRange { return workshopDateRange(input.from, input.to); }

function page(input: PageInput = {}) {
  const value = input.page ?? 1;
  const size = input.pageSize ?? 25;
  if (!Number.isInteger(value) || value < 1 || !Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw new ReportQueryError("INVALID", "Pagination laporan tidak valid.");
  return { page: value, pageSize: size, skip: (value - 1) * size };
}

function add(left: bigint, right: bigint) {
  const value = left + right;
  if (value > MAX_BIGINT) throw new ReportQueryError("INVALID", "Nilai laporan di luar batas penyimpanan.");
  return value;
}

function money(value: bigint) { return value.toString(); }

export function calculateFinancialSummary(input: { serviceRevenue: bigint; slsRevenue: bigint; hpp: bigint; expense: bigint; serviceCount: number; slsCount: number; completedPurchaseCount: number; draftPurchaseCount: number }): FinancialSummary {
  const grossProfit = input.serviceRevenue + input.slsRevenue - input.hpp;
  const netProfit = grossProfit - input.expense;
  return { serviceRevenue: money(input.serviceRevenue), slsRevenue: money(input.slsRevenue), hpp: money(input.hpp), grossProfit: money(grossProfit), expense: money(input.expense), netProfit: money(netProfit), serviceCount: input.serviceCount, slsCount: input.slsCount, completedPurchaseCount: input.completedPurchaseCount, draftPurchaseCount: input.draftPurchaseCount };
}

export function classifyStock(stock: bigint, minimumStock: bigint) { return { isLow: stock <= minimumStock, isMinus: stock < 0n }; }

export function groupFinancialByDay(rows: Array<{ date: Date; serviceRevenue: bigint; slsRevenue: bigint; hpp: bigint; expense: bigint }>) {
  const groups = new Map<string, { date: string; serviceRevenue: bigint; slsRevenue: bigint; hpp: bigint; expense: bigint }>();
  for (const row of rows) {
    const key = workshopDateKey(row.date);
    const current = groups.get(key) ?? { date: key, serviceRevenue: 0n, slsRevenue: 0n, hpp: 0n, expense: 0n };
    current.serviceRevenue = add(current.serviceRevenue, row.serviceRevenue);
    current.slsRevenue = add(current.slsRevenue, row.slsRevenue);
    current.hpp = add(current.hpp, row.hpp);
    current.expense = add(current.expense, row.expense);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date)).map((row) => ({ date: row.date, serviceRevenue: money(row.serviceRevenue), slsRevenue: money(row.slsRevenue), hpp: money(row.hpp), expense: money(row.expense), grossProfit: money(row.serviceRevenue + row.slsRevenue - row.hpp), netProfit: money(row.serviceRevenue + row.slsRevenue - row.hpp - row.expense) }));
}

export async function getFinancialSummary(role: Role, input: DateInput, repository: Prisma.TransactionClient | typeof prisma = prisma) {
  requireAdmin(role);
  const dates = range(input);
  const [services, sls, expenses, completedPurchaseCount, draftPurchaseCount] = await Promise.all([
    repository.service.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { totalAmount: true, totalHpp: true } }),
    repository.sls.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { totalAmount: true, totalHpp: true } }),
    repository.expense.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { totalAmount: true } }),
    repository.purchase.count({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } } }),
    repository.purchase.count({ where: { status: "DRAFT", transactionAt: { gte: dates.from, lt: dates.toExclusive } } }),
  ]);
  const serviceRevenue = services.reduce((sum, row) => add(sum, row.totalAmount), 0n);
  const slsRevenue = sls.reduce((sum, row) => add(sum, row.totalAmount), 0n);
  const hpp = services.reduce((sum, row) => add(sum, row.totalHpp), 0n) + sls.reduce((sum, row) => add(sum, row.totalHpp), 0n);
  const expense = expenses.reduce((sum, row) => add(sum, row.totalAmount), 0n);
  return calculateFinancialSummary({ serviceRevenue, slsRevenue, hpp, expense, serviceCount: services.length, slsCount: sls.length, completedPurchaseCount, draftPurchaseCount });
}

export async function listServiceReport(role: Role, input: DateInput & PageInput & { search?: string }, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive }, ...(input.search ? { serviceNumber: { contains: input.search.trim(), mode: "insensitive" as const } } : {}) };
  const [rows, total] = await Promise.all([repository.service.findMany({ where, select: { serviceNumber: true, transactionAt: true, vehicleDescription: true, subtotal: true, discount: true, totalAmount: true, totalHpp: true }, orderBy: [{ transactionAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.service.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, transactionAt: row.transactionAt.toISOString(), subtotal: money(row.subtotal), discount: money(row.discount), totalAmount: money(row.totalAmount), totalHpp: money(row.totalHpp) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listSlsReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.sls.findMany({ where, select: { slsNumber: true, transactionAt: true, subtotal: true, discount: true, totalAmount: true, totalHpp: true, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, quantity: true, sellingPrice: true, lineAmount: true, lineHpp: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.sls.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, transactionAt: row.transactionAt.toISOString(), subtotal: money(row.subtotal), discount: money(row.discount), totalAmount: money(row.totalAmount), totalHpp: money(row.totalHpp), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), sellingPrice: money(item.sellingPrice), lineAmount: money(item.lineAmount), lineHpp: money(item.lineHpp) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listExpenseReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.expense.findMany({ where, select: { expenseNumber: true, transactionAt: true, totalAmount: true, items: { select: { description: true, quantity: true, unitPrice: true, lineAmount: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.expense.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, transactionAt: row.transactionAt.toISOString(), totalAmount: money(row.totalAmount), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), unitPrice: money(item.unitPrice), lineAmount: money(item.lineAmount) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listStockReport(role: Role, input: PageInput = {}, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const pagination = page(input); const where = { isActive: true, deletedAt: null }; const [rows, total] = await Promise.all([repository.sparePart.findMany({ where, select: { code: true, name: true, sellingPrice: true, latestBuyPrice: true, averageCost: true, stockOnHand: true, minimumStock: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.sparePart.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, sellingPrice: money(row.sellingPrice), latestBuyPrice: row.latestBuyPrice === null ? null : money(row.latestBuyPrice), averageCost: row.averageCost === null ? null : money(row.averageCost), stockOnHand: row.stockOnHand.toString(), minimumStock: row.minimumStock.toString(), ...classifyStock(row.stockOnHand, row.minimumStock) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listMovementReport(role: Role, input: DateInput & PageInput & { sparePartId?: string }, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const sparePartId = input.sparePartId === undefined ? undefined : BigInt(input.sparePartId); const where = { occurredAt: { gte: dates.from, lt: dates.toExclusive }, ...(sparePartId === undefined ? {} : { sparePartId }) };
  const [rows, total] = await Promise.all([repository.stockMovement.findMany({ where, select: { id: true, movementType: true, quantity: true, unitCost: true, sourceType: true, sourceId: true, sourceRevision: true, sourceOperation: true, occurredAt: true, sparePart: { select: { code: true, name: true } } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.stockMovement.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, id: row.id.toString(), quantity: row.quantity.toString(), unitCost: row.unitCost === null ? null : money(row.unitCost), occurredAt: row.occurredAt.toISOString() })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listStockOpnameReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.stockOpname.findMany({ where, select: { id: true, opnameNumber: true, transactionAt: true, status: true, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, systemStock: true, physicalStock: true, difference: true, sparePartId: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.stockOpname.count({ where })]);
  const ids = rows.map((row) => row.id.toString()); const movements = ids.length ? await repository.stockMovement.findMany({ where: { sourceType: "STOCK_OPNAME", sourceId: { in: ids } }, select: { sourceId: true, sparePartId: true, quantity: true, movementType: true, sourceRevision: true, sourceOperation: true }, orderBy: { id: "asc" } }) : [];
  const bySource = new Map<string, typeof movements>(); for (const movement of movements) bySource.set(movement.sourceId, [...(bySource.get(movement.sourceId) ?? []), movement]);
  return { rows: rows.map((row) => ({ id: row.id.toString(), opnameNumber: row.opnameNumber, transactionAt: row.transactionAt.toISOString(), status: row.status, items: row.items.map((item) => ({ ...item, sparePartId: item.sparePartId.toString(), systemStock: item.systemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: item.difference?.toString() ?? null, appliedAdjustment: money((bySource.get(row.id.toString()) ?? []).filter((movement) => movement.sparePartId === item.sparePartId).reduce((sum, movement) => sum + movement.quantity, 0n)) })), appliedMovements: (bySource.get(row.id.toString()) ?? []).map((movement) => ({ ...movement, sparePartId: movement.sparePartId.toString(), quantity: movement.quantity.toString() })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}
