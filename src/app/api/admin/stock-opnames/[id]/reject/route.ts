import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { rejectStockOpname, StockOpnameServiceError } from "@/server/stock-opname-service";

const schema = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).default({});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const raw = (await context.params).id;
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) <= 0n) return NextResponse.json({ error: "Stock Opname tidak ditemukan." }, { status: 404 });
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Reason Reject tidak valid." }, { status: 400 });
  try {
    const result = await rejectStockOpname(BigInt(raw), parsed.data.reason ?? null, { id: auth.session!.user.id, username: auth.session!.user.username }, key);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StockOpnameServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" ? 400 : 409 });
    throw error;
  }
}
