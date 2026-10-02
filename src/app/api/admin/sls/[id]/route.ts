import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime } from "@/server/datetime";
import { SlsServiceError, updateCompletedSls } from "@/server/sls-service";

type Context = { params: Promise<{ id: string }> };
const integer = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value <= 9_223_372_036_854_775_807n);
const schema = z.object({ transactionAt: z.string(), discount: integer, items: z.array(z.object({ sparePartId: integer, quantity: integer, sellingPrice: integer.optional() })), reason: z.string().max(1000) });

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const rawId = (await context.params).id;
  if (!/^\d{1,19}$/.test(rawId) || BigInt(rawId) <= 0n) return NextResponse.json({ error: "SLS tidak ditemukan." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data SLS tidak valid." }, { status: 400 });
  try { return NextResponse.json({ sls: await updateCompletedSls(BigInt(rawId), { ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }, { id: auth.session!.user.id, username: auth.session!.user.username }, key) }); }
  catch (error) { if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 }); if (error instanceof SlsServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409 }); throw error; }
}
