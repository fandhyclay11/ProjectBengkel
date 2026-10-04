import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { classifyStock, ReportQueryError } from "@/server/report-query-service";
import { workshopDateKey, workshopDateRange, workshopDateTimeInput, workshopTimezone, type WorkshopDateRange } from "@/server/datetime";

type Repository = Prisma.TransactionClient | typeof prisma;
export type DashboardPreset = "today" | "week" | "month" | "custom";
export type DashboardInput = { preset?: DashboardPreset; from?: string; to?: string };
export type DashboardBucket = { key: string; label: string; from: string; to: string; serviceRevenue: string; slsRevenue: string; totalRevenue: string; grossProfit?: string };
export type DashboardResult = {
  period: { preset: DashboardPreset; from: string; to: string; timezone: string };
  kpis: { serviceRevenue: string; slsRevenue: string; grossProfit: string; netProfit: string; expenseTotal: string; serviceCount: number; slsCount: number; completedPurchaseCount: number; pendingPurchaseDraftCount: number; lowStockCount: number };
  charts: { revenue: DashboardBucket[]; grossProfit: Array<Pick<DashboardBucket, "key" | "label" | "from" | "to" | "grossProfit">> };
  monitoring: { lowStockCount: number; lowStockParts: DashboardPart[] };
};
export type DashboardPart = { id: string; code: string; name: string; currentStock: string; minimumStock: string; isLow: boolean; isMinus: boolean };
type BucketValue = { key: string; label: string; from: string; to: string; serviceRevenue: bigint; slsRevenue: bigint; hpp: bigint };

function dateOnly(value: Date) { return workshopDateTimeInput(value).slice(0, 10); }
function shiftDate(value: string, amount: number) { const [year, month, day] = value.split("-").map(Number); const result = new Date(Date.UTC(year, month - 1, day + amount)); return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`; }
function monday(value: string) { const [year, month, day] = value.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day)); const weekday = date.getUTCDay(); return shiftDate(value, weekday === 0 ? -6 : 1 - weekday); }
function isoDate(value: string) { return value.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"); }
function dateFromKey(value: Date) { return isoDate(workshopDateKey(value)); }
function sum(values: bigint[]) { return values.reduce((total, value) => total + value, 0n); }
function money(value: bigint) { return value.toString(); }

export function resolveDashboardPeriod(input: DashboardInput, now = new Date()) {
  const today = dateOnly(now);
  const preset = input.preset ?? "month";
  if (preset === "custom") {
    if (!input.from || !input.to) throw new ReportQueryError("INVALID", "Rentang custom Dashboard harus memiliki tanggal awal dan akhir.");
    workshopDateRange(input.from, input.to);
    return { preset, from: input.from, to: input.to };
  }
  if (preset === "today") return { preset, from: today, to: today };
  if (preset === "week") return { preset, from: monday(today), to: shiftDate(monday(today), 6) };
  if (preset === "month") return { preset, from: `${today.slice(0, 8)}01`, to: (() => { const [year, month] = today.split("-").map(Number); const end = new Date(Date.UTC(year, month, 0)); return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`; })() };
  throw new ReportQueryError("INVALID", "Preset Dashboard tidak valid.");
}

function addDays(value: string, count: number) { return shiftDate(value, count); }
function periodDays(from: string, to: string) { const [fy, fm, fd] = from.split("-").map(Number); const [ty, tm, td] = to.split("-").map(Number); return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1; }
function bucketMode(days: number) { return days <= 31 ? "day" : days <= 90 ? "week" : "month"; }

function makeBuckets(from: string, to: string) {
  const mode = bucketMode(periodDays(from, to)); const buckets: Array<{ key: string; label: string; from: string; to: string }> = [];
  if (mode === "day") for (let date = from; date <= to; date = addDays(date, 1)) buckets.push({ key: date, label: date, from: date, to: date });
  else if (mode === "week") for (let start = monday(from); start <= to; start = addDays(start, 7)) { const end = [addDays(start, 6), to].sort()[0]!; buckets.push({ key: start, label: `${start} s/d ${end}`, from: start < from ? from : start, to: end }); }
  else { let cursor = `${from.slice(0, 7)}-01`; while (cursor <= to) { const [year, month] = cursor.split("-").map(Number); const endOfMonth = new Date(Date.UTC(year, month, 0)); const end = `${endOfMonth.getUTCFullYear()}-${String(endOfMonth.getUTCMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getUTCDate()).padStart(2, "0")}`; buckets.push({ key: cursor.slice(0, 7), label: cursor.slice(0, 7), from: cursor < from ? from : cursor, to: end > to ? to : end }); cursor = shiftDate(cursor, endOfMonth.getUTCDate()); } }
  return { mode, buckets };
}

function bucketFor<T extends { key: string; from: string; to: string }>(date: string, mode: string, buckets: T[]) { const target = mode === "day" ? date : mode === "week" ? monday(date) : date.slice(0, 7); return buckets.find((bucket) => target >= bucket.key && target <= bucket.to) ?? buckets.find((bucket) => date >= bucket.from && date <= bucket.to); }

export function groupDashboardRows(rows: Array<{ date: Date; serviceRevenue: bigint; slsRevenue: bigint; hpp: bigint }>, from: string, to: string) {
  const { mode, buckets } = makeBuckets(from, to); const values: BucketValue[] = buckets.map((bucket) => ({ ...bucket, serviceRevenue: 0n, slsRevenue: 0n, hpp: 0n }));
  for (const row of rows) { const bucket = bucketFor(dateFromKey(row.date), mode, values); if (!bucket) continue; bucket.serviceRevenue += row.serviceRevenue; bucket.slsRevenue += row.slsRevenue; bucket.hpp += row.hpp; }
  return { mode, buckets: values.map((bucket) => ({ key: bucket.key, label: bucket.label, from: bucket.from, to: bucket.to, serviceRevenue: money(bucket.serviceRevenue), slsRevenue: money(bucket.slsRevenue), totalRevenue: money(bucket.serviceRevenue + bucket.slsRevenue), grossProfit: money(bucket.serviceRevenue + bucket.slsRevenue - bucket.hpp) })) };
}

export async function getDashboard(role: "ADMIN" | "USER", input: DashboardInput, repository: Repository = prisma): Promise<DashboardResult> {
  if (role !== "ADMIN") throw new ReportQueryError("FORBIDDEN", "Akses Dashboard ditolak.");
  const period = resolveDashboardPeriod(input); const dates: WorkshopDateRange = workshopDateRange(period.from, period.to);
  const [services, sls, expenses, completedPurchaseCount, pendingPurchaseDraftCount, parts] = await Promise.all([
    repository.service.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { transactionAt: true, totalAmount: true, totalHpp: true } }),
    repository.sls.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { transactionAt: true, totalAmount: true, totalHpp: true } }),
    repository.expense.findMany({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } }, select: { transactionAt: true, totalAmount: true } }),
    repository.purchase.count({ where: { status: "COMPLETED", transactionAt: { gte: dates.from, lt: dates.toExclusive } } }),
    repository.purchase.count({ where: { status: "DRAFT" } }),
    repository.sparePart.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, code: true, name: true, stockOnHand: true, minimumStock: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  const serviceRevenue = sum(services.map((row) => row.totalAmount)); const slsRevenue = sum(sls.map((row) => row.totalAmount)); const hpp = sum(services.map((row) => row.totalHpp)) + sum(sls.map((row) => row.totalHpp)); const expense = sum(expenses.map((row) => row.totalAmount));
  const grossProfit = serviceRevenue + slsRevenue - hpp; const netProfit = grossProfit - expense;
  const grouped = groupDashboardRows([...services.map((row) => ({ date: row.transactionAt, serviceRevenue: row.totalAmount, slsRevenue: 0n, hpp: row.totalHpp })), ...sls.map((row) => ({ date: row.transactionAt, serviceRevenue: 0n, slsRevenue: row.totalAmount, hpp: row.totalHpp }))], period.from, period.to);
  const monitoring = parts.map((part) => ({ id: part.id.toString(), code: part.code, name: part.name, currentStock: part.stockOnHand.toString(), minimumStock: part.minimumStock.toString(), ...classifyStock(part.stockOnHand, part.minimumStock) }));
  const lowStockParts = monitoring.filter((part) => part.isLow);
  return { period: { ...period, timezone: workshopTimezone() }, kpis: { serviceRevenue: money(serviceRevenue), slsRevenue: money(slsRevenue), grossProfit: money(grossProfit), netProfit: money(netProfit), expenseTotal: money(expense), serviceCount: services.length, slsCount: sls.length, completedPurchaseCount, pendingPurchaseDraftCount, lowStockCount: lowStockParts.length }, charts: { revenue: grouped.buckets, grossProfit: grouped.buckets.map(({ key, label, from, to, grossProfit: value }) => ({ key, label, from, to, grossProfit: value! })) }, monitoring: { lowStockCount: lowStockParts.length, lowStockParts } };
}
