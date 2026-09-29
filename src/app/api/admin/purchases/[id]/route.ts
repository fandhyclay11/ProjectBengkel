import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime } from "@/server/datetime";
import { deletePurchaseDraft, PurchaseServiceError, updatePurchaseDraft } from "@/server/purchase-service";

type Context = { params: Promise<{ id: string }> };
const positiveInt8 = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value > 0n && value <= 9_223_372_036_854_775_807n);
const bodySchema = z.object({
  transactionAt: z.string(),
  supplierName: z.string().max(200),
  items: z.array(z.object({ sparePartId: positiveInt8, quantity: positiveInt8, unitBuyPrice: positiveInt8 })),
});
function idOf(value: string) { return /^\d+$/.test(value) ? BigInt(value) : null; }
function failure(error: unknown) {
  if (error instanceof PurchaseServiceError) {
    const status = error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const id = idOf((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data Purchase tidak valid." }, { status: 400 });
  try {
    const purchase = await updatePurchaseDraft(id, { ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }, { id: auth.session!.user.id, username: auth.session!.user.username }, key);
    return NextResponse.json({ purchase });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const id = idOf((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  try {
    return NextResponse.json(await deletePurchaseDraft(id, { id: auth.session!.user.id, username: auth.session!.user.username }, key));
  } catch (error) { return failure(error); }
}
