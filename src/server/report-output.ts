import "server-only";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { workshopDateTimeDisplay } from "@/server/datetime";
import type { FinancialSummary, ReportName, ReportPage } from "@/server/report-query-service";

export type ReportHeader = { title: string; from: string; to: string; timezone: string; generatedAt: string; workshopName: string };
export const reportTitles: Record<ReportName, string> = {
  services: "Service Report", sls: "SLS Report", purchases: "Purchase Report", expenses: "Operational Expense Report",
  stock: "Stock / Sparepart Report", movements: "Stock Movement Report", "stock-opnames": "Stock Opname Result Report", "profit-loss": "Profit & Loss Report",
};
export function reportHeader(report: ReportName, from: string, to: string, generatedAt = new Date()) {
  return { title: reportTitles[report], from, to, timezone: process.env.APP_WORKSHOP_TIMEZONE?.trim() || "Asia/Jakarta", generatedAt: generatedAt.toISOString(), workshopName: process.env.APP_WORKSHOP_NAME?.trim() || "Project Bengkel" } satisfies ReportHeader;
}

type Row = Record<string, unknown>;
type ReportResult = ReportPage<unknown> | { summary: FinancialSummary };
function value(input: unknown): string { if (input === null || input === undefined || input === "") return "-"; return String(input); }
function money(input: unknown): string { if (input === null || input === undefined || input === "") return "-"; const raw = String(input); const negative = raw.startsWith("-"); const digits = raw.replace(/^-/, ""); return `${negative ? "-" : ""}Rp ${Number(digits).toLocaleString("id-ID")}`; }
function qty(input: unknown): string { return value(input); }
function date(input: unknown, timezone: string): string { return input ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(String(input))) : "-"; }
function rowsFor(page: ReportResult): Row[] { return "summary" in page ? [page.summary as unknown as Row] : page.rows as Row[]; }

function flatRows(report: ReportName, page: ReportResult) {
  const output: Row[] = [];
  for (const row of rowsFor(page)) {
    if (["services", "sls", "purchases", "expenses"].includes(report) && Array.isArray(row.items) && row.items.length) {
      const { items, ...header } = row; output.push({ ...header, detail: (items as unknown[]).map(value).join(" | ") });
    } else output.push(row);
  }
  return output;
}

export async function createExcel(report: ReportName, header: ReportHeader, page: ReportResult) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Report");
  sheet.addRows([[header.workshopName], [header.title], [`Periode: ${header.from} s/d ${header.to}`], [`Timezone: ${header.timezone}`], [`Dibuat: ${workshopDateTimeDisplay(new Date(header.generatedAt))}`], []]);
  const rows = flatRows(report, page); const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]; sheet.addRow(keys);
  for (const row of rows) sheet.addRow(keys.map((key) => value(row[key])));
  sheet.getRow(1).font = { bold: true, size: 14 }; sheet.getRow(2).font = { bold: true, size: 12 }; sheet.getRow(6).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 6 }]; sheet.columns.forEach((column) => { column.width = 20; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type PdfColumn = { title: string; width: number; align?: "left" | "right" | "center" };
class PdfReport {
  readonly document: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;
  constructor(private readonly header: ReportHeader) {
    this.document = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    this.document.on("data", (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise((resolve, reject) => { this.document.on("end", () => resolve(Buffer.concat(this.chunks))); this.document.on("error", reject); });
    this.headerBlock();
  }
  private headerBlock() { this.document.font("Helvetica-Bold").fontSize(16).text(this.header.workshopName); this.document.fontSize(13).text(this.header.title); this.document.font("Helvetica").fontSize(9).text(`Periode: ${this.header.from} s/d ${this.header.to} | Timezone: ${this.header.timezone}`).text(`Dibuat: ${workshopDateTimeDisplay(new Date(this.header.generatedAt))}`); this.document.moveDown(1); }
  private ensure(height: number) { if (this.document.y + height > this.document.page.height - 58) this.document.addPage(); }
  section(title: string) { this.ensure(30); this.document.moveDown(0.5); this.document.font("Helvetica-Bold").fontSize(11).fillColor("#16324f").text(title); this.document.fillColor("#000000").font("Helvetica").fontSize(9); }
  lines(lines: Array<[string, unknown]>) { this.ensure(lines.length * 14 + 4); for (const [key, item] of lines) this.document.font("Helvetica-Bold").text(`${key}: `, { continued: true }).font("Helvetica").text(value(item)); }
  table(columns: PdfColumn[], rows: string[][]) {
    const x = this.document.page.margins.left; const right = this.document.page.width - this.document.page.margins.right; const width = right - x;
    const widths = columns.map((column) => column.width * width / columns.reduce((sum, item) => sum + item.width, 0));
    const drawRow = (cells: string[], header: boolean) => {
      const heights = cells.map((cell, index) => this.document.heightOfString(cell, { width: widths[index]! - 8, lineGap: 1 })); const height = Math.max(18, ...heights) + 7;
      this.ensure(height + (header ? 0 : 0)); let cursor = x;
      if (header) this.document.save().rect(x, this.document.y, width, height).fill("#dbe7f2").restore();
      cells.forEach((cell, index) => { this.document.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(8).text(cell, cursor + 4, this.document.y + 4, { width: widths[index]! - 8, height: height - 6, align: columns[index]!.align ?? "left" }); cursor += widths[index]!; });
      this.document.moveTo(x, this.document.y + height).lineTo(right, this.document.y + height).strokeColor("#aab7c4").stroke(); this.document.y += height;
    };
    drawRow(columns.map((column) => column.title), true); for (const row of rows) { if (this.document.y > this.document.page.height - 90) { this.document.addPage(); drawRow(columns.map((column) => column.title), true); } drawRow(row, false); }
  }
  cardStart(title: string, number: unknown) { this.ensure(48); this.document.moveDown(0.8); this.document.font("Helvetica-Bold").fontSize(11).text(title); this.document.font("Helvetica-Bold").fontSize(13).text(value(number)); this.document.font("Helvetica").fontSize(9); }
  finish() { const range = this.document.bufferedPageRange(); for (let index = 0; index < range.count; index += 1) { this.document.switchToPage(index); this.document.font("Helvetica").fontSize(8).fillColor("#52606d").text(`Page ${index + 1} of ${range.count}`, 40, this.document.page.height - 35, { align: "right", width: this.document.page.width - 80 }); } this.document.end(); return this.done; }
}

function renderService(pdf: PdfReport, rows: Row[], timezone: string) {
  for (const row of rows) {
    pdf.cardStart("SERVICE", row.serviceNumber); pdf.lines([["Tanggal", date(row.transactionAt, timezone)], ["Kendaraan", row.vehicleDescription]]);
    pdf.section("Pekerjaan"); const jobs = Array.isArray(row.jobs) ? row.jobs as Row[] : []; pdf.table([{ title: "Deskripsi", width: 4 }, { title: "Jumlah", width: 2, align: "right" }], jobs.map((job) => [value(job.description), money(job.amount)]));
    pdf.section("Sparepart"); const items = Array.isArray(row.items) ? row.items as Row[] : []; pdf.table([{ title: "Kode", width: 2 }, { title: "Nama", width: 4 }, { title: "Qty", width: 1, align: "right" }, { title: "Harga Jual", width: 2, align: "right" }, { title: "Jumlah", width: 2, align: "right" }], items.map((item) => [value(item.partCodeSnapshot), value(item.partNameSnapshot), qty(item.quantity), money(item.sellingPrice), money(item.lineAmount)]));
    pdf.lines([["Subtotal", money(row.subtotal)], ["Diskon", money(row.discount)], ["Total", money(row.totalAmount)], ["HPP (Admin)", money(row.totalHpp)]]);
  }
}

function renderSls(pdf: PdfReport, rows: Row[], timezone: string) { for (const row of rows) { pdf.cardStart("SLS", row.slsNumber); pdf.lines([["Tanggal", date(row.transactionAt, timezone)]]); const items = Array.isArray(row.items) ? row.items as Row[] : []; pdf.table([{ title: "Kode", width: 2 }, { title: "Nama", width: 4 }, { title: "Qty", width: 1, align: "right" }, { title: "Harga Jual", width: 2, align: "right" }, { title: "Jumlah", width: 2, align: "right" }, { title: "HPP", width: 2, align: "right" }], items.map((item) => [value(item.partCodeSnapshot), value(item.partNameSnapshot), qty(item.quantity), money(item.sellingPrice), money(item.lineAmount), money(item.lineHpp)])); pdf.lines([["Subtotal", money(row.subtotal)], ["Diskon", money(row.discount)], ["Total", money(row.totalAmount)], ["HPP (Admin)", money(row.totalHpp)]]); } }
function renderPurchase(pdf: PdfReport, rows: Row[], timezone: string) { for (const row of rows) { pdf.cardStart("PURCHASE", row.purchaseNumber); pdf.lines([["Tanggal", date(row.transactionAt, timezone)], ["Supplier", row.supplierName], ["Status", "COMPLETED"]]); const items = Array.isArray(row.items) ? row.items as Row[] : []; pdf.table([{ title: "Kode", width: 2 }, { title: "Nama", width: 4 }, { title: "Qty", width: 1, align: "right" }, { title: "Harga Beli", width: 2, align: "right" }, { title: "Jumlah", width: 2, align: "right" }], items.map((item) => [value(item.partCodeSnapshot), value(item.partNameSnapshot), qty(item.quantity), money(item.unitBuyPrice), money(item.lineAmount)])); pdf.lines([["Total", money(row.totalAmount)]]); } }
function renderExpense(pdf: PdfReport, rows: Row[], timezone: string) { for (const row of rows) { pdf.cardStart("OPERATIONAL EXPENSE", row.expenseNumber); pdf.lines([["Tanggal", date(row.transactionAt, timezone)]]); const items = Array.isArray(row.items) ? row.items as Row[] : []; pdf.table([{ title: "Description", width: 4 }, { title: "Qty", width: 1, align: "right" }, { title: "Unit Price", width: 2, align: "right" }, { title: "Line Amount", width: 2, align: "right" }], items.map((item) => [value(item.description), qty(item.quantity), money(item.unitPrice), money(item.lineAmount)])); pdf.lines([["Total", money(row.totalAmount)]]); } }
function renderStock(pdf: PdfReport, rows: Row[]) { pdf.table([{ title: "Code", width: 2 }, { title: "Name", width: 4 }, { title: "Selling Price", width: 2, align: "right" }, { title: "Latest Buy", width: 2, align: "right" }, { title: "Current Stock", width: 2, align: "right" }, { title: "Minimum", width: 2, align: "right" }, { title: "Status", width: 2 }, { title: "AvgCost (Admin)", width: 2, align: "right" }, { title: "Inventory Value (Admin)", width: 3, align: "right" }], rows.map((row) => { const status = row.isMinus ? "MINUS" : row.isLow ? "LOW" : "OK"; const inventoryValue = row.averageCost === null || row.averageCost === undefined ? "-" : money(BigInt(String(row.stockOnHand)) * BigInt(String(row.averageCost))); return [value(row.code), value(row.name), money(row.sellingPrice), money(row.latestBuyPrice), qty(row.stockOnHand), qty(row.minimumStock), status, money(row.averageCost), inventoryValue]; })); }
function renderMovement(pdf: PdfReport, rows: Row[], timezone: string) { pdf.table([{ title: "Occurred At", width: 3 }, { title: "Sparepart", width: 4 }, { title: "Movement", width: 2 }, { title: "Signed Qty", width: 2, align: "right" }, { title: "Unit Cost", width: 2, align: "right" }, { title: "Source / Revision", width: 4 }], rows.map((row) => { const part = row.sparePart as Row | undefined; return [date(row.occurredAt, timezone), `${value(part?.code)} - ${value(part?.name)}`, value(row.movementType), qty(row.quantity), money(row.unitCost), `${value(row.sourceType)} / ${value(row.sourceId)} / rev ${value(row.sourceRevision)}${row.sourceOperation ? ` / ${value(row.sourceOperation)}` : ""}`]; })); }
function renderOpname(pdf: PdfReport, rows: Row[], timezone: string) { for (const row of rows) { pdf.cardStart("STOCK OPNAME", row.opnameNumber); pdf.lines([["Tanggal", date(row.transactionAt, timezone)], ["Status", row.status]]); const items = Array.isArray(row.items) ? row.items as Row[] : []; pdf.table([{ title: "Code", width: 2 }, { title: "Name", width: 3 }, { title: "System Stock", width: 2, align: "right" }, { title: "Physical", width: 2, align: "right" }, { title: "Difference", width: 2, align: "right" }, { title: "Applied Adjustment", width: 2, align: "right" }], items.map((item) => [value(item.partCodeSnapshot), value(item.partNameSnapshot), qty(item.systemStock), qty(item.physicalStock), qty(item.difference), qty(item.appliedAdjustment)])); const movements = Array.isArray(row.appliedMovements) ? row.appliedMovements as Row[] : []; if (movements.length) { pdf.section("Adjustment lineage"); pdf.table([{ title: "Sparepart ID", width: 2 }, { title: "Type", width: 3 }, { title: "Quantity", width: 2, align: "right" }, { title: "Revision", width: 2 }, { title: "Operation", width: 3 }], movements.map((movement) => [value(movement.sparePartId), value(movement.movementType), qty(movement.quantity), value(movement.sourceRevision), value(movement.sourceOperation)])); } } }
function renderProfitLoss(pdf: PdfReport, summary: Row) { pdf.section("Financial Summary"); pdf.table([{ title: "Metric", width: 4 }, { title: "Amount", width: 3, align: "right" }], [["Revenue Service", money(summary.serviceRevenue)], ["Revenue SLS", money(summary.slsRevenue)], ["Total Revenue", money(Number(summary.serviceRevenue) + Number(summary.slsRevenue))], ["HPP", money(summary.hpp)], ["Gross Profit", money(summary.grossProfit)], ["Operating Expense", money(summary.expense)], ["Net Profit", money(summary.netProfit)]]); pdf.section("Supporting Counts"); pdf.table([{ title: "Metric", width: 4 }, { title: "Count", width: 2, align: "right" }], [["Service transactions", value(summary.serviceCount)], ["SLS transactions", value(summary.slsCount)], ["Completed purchases", value(summary.completedPurchaseCount)], ["Draft purchases", value(summary.draftPurchaseCount)]]); }

export async function createPdf(report: ReportName, header: ReportHeader, page: ReportResult) {
  const pdf = new PdfReport(header); const rows = rowsFor(page); const timezone = header.timezone;
  if (report === "services") renderService(pdf, rows, timezone); else if (report === "sls") renderSls(pdf, rows, timezone); else if (report === "purchases") renderPurchase(pdf, rows, timezone); else if (report === "expenses") renderExpense(pdf, rows, timezone); else if (report === "stock") renderStock(pdf, rows); else if (report === "movements") renderMovement(pdf, rows, timezone); else if (report === "stock-opnames") renderOpname(pdf, rows, timezone); else renderProfitLoss(pdf, rows[0] ?? {});
  if (!rows.length) pdf.document.fontSize(10).text("Tidak ada data."); return pdf.finish();
}

export function createCsv(report: ReportName, header: ReportHeader, page: ReportResult) { const rows = flatRows(report, page); const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const escape = (item: unknown) => `"${value(item).replaceAll('"', '""')}"`; return [[header.workshopName], [header.title], [`Periode: ${header.from} s/d ${header.to}`], [`Dibuat: ${header.generatedAt}`], [], keys, ...rows.map((row) => keys.map((key) => row[key]))].map((row) => row.map(escape).join(",")).join("\r\n"); }
