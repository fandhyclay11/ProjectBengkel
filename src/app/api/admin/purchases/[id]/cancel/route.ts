import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { PurchaseServiceError, cancelPurchase } from "@/server/purchase-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const rawId = (await context.params).id;
  if (!/^\d{1,19}$/.test(rawId) || BigInt(rawId) <= 0n || BigInt(rawId) > 9_223_372_036_854_775_807n) {
    return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  }
  try {
    const purchase = await cancelPurchase(BigInt(rawId), { id: auth.session!.user.id, username: auth.session!.user.username }, key);
    return NextResponse.json({ purchase });
  } catch (error) {
    if (error instanceof PurchaseServiceError) {
      const status = error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
