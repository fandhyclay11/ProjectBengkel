import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { approveStockOpname, StockOpnameServiceError } from "@/server/stock-opname-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const raw = (await context.params).id;
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) <= 0n) return NextResponse.json({ error: "Stock Opname tidak ditemukan." }, { status: 404 });
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  try {
    const result = await approveStockOpname(BigInt(raw), { id: auth.session!.user.id, username: auth.session!.user.username }, key);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StockOpnameServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409 });
    throw error;
  }
}
