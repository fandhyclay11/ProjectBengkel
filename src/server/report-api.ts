import { z } from "zod";
import { prisma } from "@/server/db";
import { ReportQueryError, getFinancialSummary, listExpenseReport, listMovementReport, listPurchaseReport, listServiceReport, listSlsReport, listStockOpnameReport, listStockReport, type ReportName, type ReportPage } from "@/server/report-query-service";

export const reportNames = ["services", "sls", "purchases", "expenses", "stock", "movements", "stock-opnames", "profit-loss"] as const;
export const formats = ["pdf", "xlsx"] as const;
export const reportRequestSchema = z.object({ from: z.string(), to: z.string(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().max(100).optional(), sparePartId: z.string().regex(/^\d{1,19}$/).optional() });
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export async function queryReport(report: ReportName, input: ReportRequest, repository = prisma): Promise<ReportPage<unknown> | { summary: unknown }> {
  switch (report) {
    case "services": return listServiceReport("ADMIN", input, repository);
    case "sls": return listSlsReport("ADMIN", input, repository);
    case "purchases": return listPurchaseReport("ADMIN", input, repository);
    case "expenses": return listExpenseReport("ADMIN", input, repository);
    case "stock": return listStockReport("ADMIN", input, repository);
    case "movements": return listMovementReport("ADMIN", input, repository);
    case "stock-opnames": return listStockOpnameReport("ADMIN", input, repository);
    case "profit-loss": return { summary: await getFinancialSummary("ADMIN", input, repository) };
    default: throw new ReportQueryError("INVALID", "Jenis laporan tidak valid.");
  }
}

export async function collectReport(report: ReportName, input: ReportRequest, maxRows: number, repository = prisma) {
  if (report === "profit-loss") return queryReport(report, input, repository);
  const rows: unknown[] = []; let page = 1; let total = 0;
  do {
    const result = await queryReport(report, { ...input, page, pageSize: 100 }, repository) as ReportPage<unknown>;
    total = result.total; rows.push(...result.rows); page += 1;
    if (rows.length > maxRows) throw new ReportQueryError("INVALID", "Jumlah baris terlalu banyak. Persempit rentang tanggal atau filter laporan.");
    if (!result.rows.length) break;
  } while (rows.length < total);
  return { rows, page: 1, pageSize: rows.length, total } satisfies ReportPage<unknown>;
}
