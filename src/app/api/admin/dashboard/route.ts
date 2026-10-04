import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { getDashboard, type DashboardInput, type DashboardPreset } from "@/server/dashboard-query-service";
import { ReportQueryError } from "@/server/report-query-service";

const presets = new Set<DashboardPreset>(["today", "week", "month", "custom"]);

export async function GET(request: Request) {
  const auth = await requireAdmin(request, false);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const rawPreset = params.get("preset") ?? "month";
  const input: DashboardInput = { preset: rawPreset as DashboardPreset, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  if (!presets.has(input.preset!)) return NextResponse.json({ error: "Preset Dashboard tidak valid." }, { status: 400 });
  try { return NextResponse.json({ dashboard: await getDashboard("ADMIN", input) }); }
  catch (error) { if (error instanceof ReportQueryError) return NextResponse.json({ error: error.message }, { status: error.kind === "FORBIDDEN" ? 403 : 400 }); throw error; }
}
