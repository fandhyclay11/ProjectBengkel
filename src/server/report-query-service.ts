import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { workshopDateKey, workshopDateRange, workshopDateTimeInput, type WorkshopDateRange } from "@/server/datetime";

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

export type FinancialMetrics = Pick<FinancialSummary, "serviceRevenue" | "slsRevenue" | "hpp" | "grossProfit" | "expense" | "netProfit">;
export type FinancialComparison = { current: FinancialMetrics; previous: FinancialMetrics; difference: FinancialMetrics; percent: Record<keyof FinancialMetrics, string | null>; from: string; to: string; previousFrom: string; previousTo: string };
export type FinancialTrendPoint = FinancialMetrics & { month: string; monthLabel: string; totalRevenue: string };

export type ReportPage<T> = { rows: T[]; page: number; pageSize: number; total: number };
export type ReportName = "services" | "sls" | "purchases" | "expenses" | "stock" | "movements" | "stock-opnames" | "profit-loss";

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

function dateParts(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) throw new ReportQueryError("INVALID", "Tanggal laporan tidak valid."); return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }; }
function dateString(year: number, month: number, day: number) { return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function addMonths(year: number, month: number, delta: number) { const value = year * 12 + month - 1 + delta; return { year: Math.floor(value / 12), month: value % 12 + 1 }; }
function metricsFromSummary(summary: FinancialSummary): FinancialMetrics { return { serviceRevenue: summary.serviceRevenue, slsRevenue: summary.slsRevenue, hpp: summary.hpp, grossProfit: summary.grossProfit, expense: summary.expense, netProfit: summary.netProfit }; }
function differenceMetrics(current: FinancialMetrics, previous: FinancialMetrics) { return Object.fromEntries((Object.keys(current) as Array<keyof FinancialMetrics>).map((key) => [key, (BigInt(current[key]) - BigInt(previous[key])).toString()])) as FinancialMetrics; }
function percentChange(current: string, previous: string) { if (BigInt(previous) === 0n) return null; return ((Number(current) - Number(previous)) / Math.abs(Number(previous)) * 100).toFixed(2); }
function monthLabel(date: string) { return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }

const movementTypeLabels: Record<string, string> = { OPENING_STOCK: "Stok Awal", PURCHASE_RECEIPT: "Penerimaan Purchase", SERVICE_ISSUE: "Pemakaian Service", SLS_ISSUE: "Pemakaian SLS", ADJUSTMENT_IN: "Adjustment Masuk", ADJUSTMENT_OUT: "Adjustment Keluar", CORRECTION: "Koreksi", REVERSAL: "Reversal", DELETE: "Penghapusan" };
const opnameStatusLabels: Record<string, string> = { REVISION: "Revision", FINALIZED: "Finalized", APPROVED: "Approved" };

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

export async function getProfitLossComparison(role: Role, repository: Prisma.TransactionClient | typeof prisma = prisma, now = new Date()): Promise<FinancialComparison> {
  requireAdmin(role);
  const periods = profitLossComparisonPeriods(now); const { currentFrom, currentTo: today, previousFrom, previousTo } = periods;
  const currentSummary = await getFinancialSummary(role, { from: currentFrom, to: today }, repository);
  const previousSummary = await getFinancialSummary(role, { from: previousFrom, to: previousTo }, repository);
  const current = metricsFromSummary(currentSummary); const previous = metricsFromSummary(previousSummary); const difference = differenceMetrics(current, previous);
  const percent = Object.fromEntries((Object.keys(current) as Array<keyof FinancialMetrics>).map((key) => [key, percentChange(current[key], previous[key])])) as Record<keyof FinancialMetrics, string | null>;
  return { current, previous, difference, percent, from: currentFrom, to: today, previousFrom, previousTo };
}

export function profitLossComparisonPeriods(now: Date) {
  const today = workshopDateTimeInput(now).slice(0, 10); const currentParts = dateParts(today); const currentFrom = dateString(currentParts.year, currentParts.month, 1); const previousMonth = addMonths(currentParts.year, currentParts.month, -1); const comparableDay = Math.min(currentParts.day, daysInMonth(previousMonth.year, previousMonth.month));
  return { currentFrom, currentTo: today, previousFrom: dateString(previousMonth.year, previousMonth.month, 1), previousTo: dateString(previousMonth.year, previousMonth.month, comparableDay) };
}

export async function getProfitLossTrend(role: Role, repository: Prisma.TransactionClient | typeof prisma = prisma, now = new Date()): Promise<FinancialTrendPoint[]> {
  requireAdmin(role);
  const today = dateParts(workshopDateTimeInput(now).slice(0, 10));
  const points: FinancialTrendPoint[] = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const month = addMonths(today.year, today.month, offset);
    const from = dateString(month.year, month.month, 1);
    const summary = await getFinancialSummary(role, { from, to: offset === 0 ? dateString(today.year, today.month, today.day) : dateString(month.year, month.month, daysInMonth(month.year, month.month)) }, repository);
    const metrics = metricsFromSummary(summary);
    points.push({ ...metrics, month: from, monthLabel: monthLabel(from), totalRevenue: (BigInt(metrics.serviceRevenue) + BigInt(metrics.slsRevenue)).toString() });
  }
  return points;
}

export async function listServiceReport(role: Role, input: DateInput & PageInput & { search?: string }, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive }, ...(input.search ? { serviceNumber: { contains: input.search.trim(), mode: "insensitive" as const } } : {}) };
  const [rows, total] = await Promise.all([repository.service.findMany({ where, select: { serviceNumber: true, transactionAt: true, vehicleDescription: true, subtotal: true, discount: true, totalAmount: true, totalHpp: true, jobs: { select: { description: true, amount: true }, orderBy: { lineNumber: "asc" } }, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, quantity: true, sellingPrice: true, lineAmount: true, lineHpp: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.service.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, transactionAt: row.transactionAt.toISOString(), subtotal: money(row.subtotal), discount: money(row.discount), totalAmount: money(row.totalAmount), totalHpp: money(row.totalHpp), jobs: row.jobs.map((job) => ({ ...job, amount: money(job.amount) })), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), sellingPrice: money(item.sellingPrice), lineAmount: money(item.lineAmount), lineHpp: money(item.lineHpp) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listSlsReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.sls.findMany({ where, select: { id: true, slsNumber: true, transactionAt: true, subtotal: true, discount: true, totalAmount: true, totalHpp: true, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, quantity: true, sellingPrice: true, lineAmount: true, lineHpp: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.sls.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, id: row.id.toString(), transactionAt: row.transactionAt.toISOString(), subtotal: money(row.subtotal), discount: money(row.discount), totalAmount: money(row.totalAmount), totalHpp: money(row.totalHpp), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), sellingPrice: money(item.sellingPrice), lineAmount: money(item.lineAmount), lineHpp: money(item.lineHpp) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listExpenseReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.expense.findMany({ where, select: { id: true, expenseNumber: true, transactionAt: true, totalAmount: true, items: { select: { description: true, quantity: true, unitPrice: true, lineAmount: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.expense.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, id: row.id.toString(), transactionAt: row.transactionAt.toISOString(), totalAmount: money(row.totalAmount), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), unitPrice: money(item.unitPrice), lineAmount: money(item.lineAmount) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listStockReport(role: Role, input: PageInput = {}, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const pagination = page(input); const where = { isActive: true, deletedAt: null }; const [rows, total] = await Promise.all([repository.sparePart.findMany({ where, select: { code: true, name: true, sellingPrice: true, latestBuyPrice: true, averageCost: true, stockOnHand: true, minimumStock: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: pagination.skip, take: pagination.pageSize }), repository.sparePart.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, sellingPrice: money(row.sellingPrice), latestBuyPrice: row.latestBuyPrice === null ? null : money(row.latestBuyPrice), averageCost: row.averageCost === null ? null : money(row.averageCost), stockOnHand: row.stockOnHand.toString(), minimumStock: row.minimumStock.toString(), ...classifyStock(row.stockOnHand, row.minimumStock) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listMovementReport(role: Role, input: DateInput & PageInput & { sparePartId?: string }, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const sparePartId = input.sparePartId === undefined ? undefined : BigInt(input.sparePartId); const where = { occurredAt: { gte: dates.from, lt: dates.toExclusive }, ...(sparePartId === undefined ? {} : { sparePartId }) };
  const [rows, total] = await Promise.all([repository.stockMovement.findMany({ where, select: { id: true, movementType: true, quantity: true, unitCost: true, sourceType: true, sourceId: true, sourceRevision: true, sourceOperation: true, occurredAt: true, sparePart: { select: { code: true, name: true } } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.stockMovement.count({ where })]);
  return { rows: rows.map((row) => ({ id: row.id.toString(), movementType: row.movementType, movementLabel: movementTypeLabels[row.movementType] ?? row.movementType, quantity: row.quantity.toString(), unitCost: row.unitCost === null ? null : money(row.unitCost), sourceType: row.sourceType, sourceId: row.sourceId, sourceRevision: row.sourceRevision, sourceOperation: row.sourceOperation, occurredAt: row.occurredAt.toISOString(), sparePartCode: row.sparePart.code, sparePartName: row.sparePart.name })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listStockOpnameReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.stockOpname.findMany({ where, select: { id: true, opnameNumber: true, transactionAt: true, status: true, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, systemStock: true, physicalStock: true, difference: true, sparePartId: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.stockOpname.count({ where })]);
  const ids = rows.map((row) => row.id.toString()); const movements = ids.length ? await repository.stockMovement.findMany({ where: { sourceType: "STOCK_OPNAME", sourceId: { in: ids } }, select: { sourceId: true, sparePartId: true, quantity: true, movementType: true, sourceRevision: true, sourceOperation: true, sourceType: true, sparePart: { select: { code: true, name: true } } }, orderBy: { id: "asc" } }) : [];
  const bySource = new Map<string, typeof movements>(); for (const movement of movements) bySource.set(movement.sourceId, [...(bySource.get(movement.sourceId) ?? []), movement]);
  return { rows: rows.map((row) => ({ id: row.id.toString(), opnameNumber: row.opnameNumber, transactionAt: row.transactionAt.toISOString(), status: row.status, statusLabel: opnameStatusLabels[row.status] ?? row.status, items: row.items.map((item) => ({ ...item, sparePartId: item.sparePartId.toString(), systemStock: item.systemStock.toString(), physicalStock: item.physicalStock?.toString() ?? null, difference: item.difference?.toString() ?? null, appliedAdjustment: money((bySource.get(row.id.toString()) ?? []).filter((movement) => movement.sparePartId === item.sparePartId).reduce((sum, movement) => sum + movement.quantity, 0n)) })), appliedMovements: (bySource.get(row.id.toString()) ?? []).map((movement) => ({ movementType: movement.movementType, movementLabel: movementTypeLabels[movement.movementType] ?? movement.movementType, sparePartId: movement.sparePartId.toString(), sparePartCode: movement.sparePart.code, sparePartName: movement.sparePart.name, quantity: movement.quantity.toString(), sourceType: movement.sourceType, sourceId: movement.sourceId, sourceRevision: movement.sourceRevision, sourceOperation: movement.sourceOperation })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}

export async function listPurchaseReport(role: Role, input: DateInput & PageInput, repository: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReportPage<unknown>> {
  requireAdmin(role); const dates = range(input); const pagination = page(input); const where = { status: "COMPLETED" as const, transactionAt: { gte: dates.from, lt: dates.toExclusive } };
  const [rows, total] = await Promise.all([repository.purchase.findMany({ where, select: { id: true, purchaseNumber: true, transactionAt: true, supplierName: true, totalAmount: true, items: { select: { partCodeSnapshot: true, partNameSnapshot: true, quantity: true, unitBuyPrice: true, lineAmount: true }, orderBy: { lineNumber: "asc" } } }, orderBy: [{ transactionAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.pageSize }), repository.purchase.count({ where })]);
  return { rows: rows.map((row) => ({ ...row, id: row.id.toString(), transactionAt: row.transactionAt.toISOString(), totalAmount: money(row.totalAmount), items: row.items.map((item) => ({ ...item, quantity: item.quantity.toString(), unitBuyPrice: money(item.unitBuyPrice), lineAmount: money(item.lineAmount) })) })), page: pagination.page, pageSize: pagination.pageSize, total };
}
