import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { collectReport, formats, reportNames, reportRequestSchema } from "@/server/report-api";
import { ReportQueryError } from "@/server/report-query-service";
import { createExcel, createPdf, reportHeader } from "@/server/report-output";

const limits = { pdf: 20_000, xlsx: 100_000 } as const;
async function exportReport(request: Request, context: { params: Promise<{ report: string; format: string }> }) {
  const auth = await requireAdmin(request, true); if (auth.response) return auth.response;
  const { report: rawReport, format: rawFormat } = await context.params;
  if (!reportNames.includes(rawReport as typeof reportNames[number]) || !formats.includes(rawFormat as typeof formats[number])) return NextResponse.json({ error: "Format atau jenis laporan tidak valid." }, { status: 400 });
  const parsed = reportRequestSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams)); if (!parsed.success) return NextResponse.json({ error: "Parameter export tidak valid." }, { status: 400 });
  const report = rawReport as typeof reportNames[number]; const format = rawFormat as typeof formats[number]; const generatedAt = new Date();
  try {
    const result = await collectReport(report, parsed.data, limits[format]);
    const header = reportHeader(report, parsed.data.from, parsed.data.to, generatedAt);
    const body = format === "pdf" ? await createPdf(report, header, result as never) : await createExcel(report, header, result as never);
    const bytes = typeof body === "string" ? Buffer.from(body) : body;
    await prisma.$transaction((tx) => writeAudit(tx, { actorId: auth.session!.user.id, actorUsername: auth.session!.user.username, action: format === "pdf" ? "REPORT_PDF_EXPORTED" : "REPORT_EXCEL_EXPORTED", objectType: "REPORT", objectId: report, context: { period: { from: parsed.data.from, to: parsed.data.to }, format, generatedAt: generatedAt.toISOString(), rowCount: "total" in result ? result.total : null } }));
    return new NextResponse(bytes as BodyInit, { headers: { "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${report}-${parsed.data.from}-${parsed.data.to}.${format === "pdf" ? "pdf" : "xlsx"}"`, "cache-control": "private, no-store" } });
  } catch (error) { const message = error instanceof Error ? error.message : "Export gagal."; await prisma.$transaction((tx) => writeAudit(tx, { actorId: auth.session!.user.id, actorUsername: auth.session!.user.username, action: format === "pdf" ? "REPORT_PDF_EXPORT_FAILED" : "REPORT_EXCEL_EXPORT_FAILED", objectType: "REPORT", objectId: report, context: { period: { from: parsed.data.from, to: parsed.data.to }, format, generatedAt: generatedAt.toISOString(), error: message } })).catch(() => undefined); if (error instanceof ReportQueryError) return NextResponse.json({ error: error.message }, { status: 400 }); throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ report: string; format: string }> }) {
  return exportReport(request, context);
}
