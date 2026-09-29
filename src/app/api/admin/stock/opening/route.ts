import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { StockServiceError, recordOpeningStock } from "@/server/stock-service";

const maxBigInt = 9_223_372_036_854_775_807n;
const positiveInteger = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value > 0n && value <= maxBigInt);
const schema = z.object({ sparePartId: positiveInteger, quantity: positiveInteger, unitCost: positiveInteger });

function handleError(error: unknown) {
  if (!(error instanceof StockServiceError)) throw error;
  const status = error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" ? 400 : 409;
  return NextResponse.json({ error: error.message }, { status });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Jumlah stok dan biaya per barang harus berupa bilangan bulat lebih dari Rp0." }, { status: 400 });
  try {
    const result = await recordOpeningStock({ ...parsed.data, key }, { id: auth.session!.user.id, username: auth.session!.user.username });
    return NextResponse.json({ result });
  } catch (error) {
    return handleError(error);
  }
}
