import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { listMovementsForAdmin } from "@/server/stock-service";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, false);
  if (auth.response) return auth.response;
  const rawId = new URL(request.url).searchParams.get("sparePartId");
  if (rawId !== null && !/^\d{1,19}$/.test(rawId)) {
    return NextResponse.json({ error: "Sparepart tidak valid." }, { status: 400 });
  }
  const sparePartId = rawId === null ? undefined : BigInt(rawId);
  if (sparePartId !== undefined && (sparePartId <= 0n || sparePartId > 9_223_372_036_854_775_807n)) {
    return NextResponse.json({ error: "Sparepart tidak valid." }, { status: 400 });
  }
  const movements = await listMovementsForAdmin(sparePartId, 200);
  return NextResponse.json({ movements });
}
