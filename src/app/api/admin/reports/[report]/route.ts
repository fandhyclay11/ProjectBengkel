import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { queryReport, reportNames, reportRequestSchema } from "@/server/report-api";
import { ReportQueryError } from "@/server/report-query-service";

export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  const auth = await requireAdmin(request, false); if (auth.response) return auth.response;
  const report = (await context.params).report;
  if (!reportNames.includes(report as typeof reportNames[number])) return NextResponse.json({ error: "Jenis laporan tidak valid." }, { status: 400 });
  const parsed = reportRequestSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parameter laporan tidak valid." }, { status: 400 });
  try { const generatedAt = new Date().toISOString(); return NextResponse.json({ report, generatedAt, result: await queryReport(report as typeof reportNames[number], parsed.data) }); }
  catch (error) { if (error instanceof ReportQueryError) return NextResponse.json({ error: error.message }, { status: error.kind === "FORBIDDEN" ? 403 : 400 }); throw error; }
}
