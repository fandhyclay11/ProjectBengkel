import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime } from "@/server/datetime";
import { PurchaseServiceError, updateCompletedPurchase } from "@/server/purchase-service";

type Context = { params: Promise<{ id: string }> };
const positiveInt8 = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value > 0n && value <= 9_223_372_036_854_775_807n);
const bodySchema = z.object({
  transactionAt: z.string(), supplierName: z.string().max(200),
  items: z.array(z.object({ sparePartId: positiveInt8, quantity: positiveInt8, unitBuyPrice: positiveInt8 })),
  reason: z.string().max(1000).optional(),
});

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const rawId = (await context.params).id;
  if (!/^\d{1,19}$/.test(rawId) || BigInt(rawId) <= 0n || BigInt(rawId) > 9_223_372_036_854_775_807n) {
    return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data Purchase tidak valid." }, { status: 400 });
  try {
    const purchase = await updateCompletedPurchase(
      BigInt(rawId),
      { ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) },
      { id: auth.session!.user.id, username: auth.session!.user.username },
      key,
    );
    return NextResponse.json({ purchase });
  } catch (error) {
    if (error instanceof PurchaseServiceError) {
      const status = error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
