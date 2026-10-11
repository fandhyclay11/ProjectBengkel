import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, workshopDateRange, workshopDateTimeInput } from "@/server/datetime";
import { listMovementsForAdmin } from "@/server/stock-service";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, false);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const today = workshopDateTimeInput(new Date()).slice(0, 10);
  if ((rawFrom === null) !== (rawTo === null)) return NextResponse.json({ error: "Parameter from dan to wajib digunakan bersama." }, { status: 400 });
  const from = rawFrom ?? today;
  const to = rawTo ?? today;
  let dateRange;
  try { dateRange = workshopDateRange(from, to); } catch (error) { if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 }); throw error; }
  const rawId = params.get("sparePartId");
  if (rawId !== null && !/^\d{1,19}$/.test(rawId)) {
    return NextResponse.json({ error: "Sparepart tidak valid." }, { status: 400 });
  }
  const sparePartId = rawId === null ? undefined : BigInt(rawId);
  if (sparePartId !== undefined && (sparePartId <= 0n || sparePartId > 9_223_372_036_854_775_807n)) {
    return NextResponse.json({ error: "Sparepart tidak valid." }, { status: 400 });
  }
  const movements = await listMovementsForAdmin(sparePartId, dateRange);
  return NextResponse.json({ movements });
}
