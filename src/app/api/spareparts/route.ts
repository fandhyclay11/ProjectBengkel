import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, requireAdmin } from "@/server/auth";
import { createSparePart, listSpareParts, SparePartServiceError } from "@/server/sparepart-service";

const maxInteger = 9_223_372_036_854_775_807n;
const money = z.string().regex(/^-?\d+$/, "Nominal harus Rupiah bulat.").max(20).refine((value) => {
  const amount = BigInt(value);
  return amount >= -9_223_372_036_854_775_808n && amount <= maxInteger;
}, "Nominal di luar batas penyimpanan.").transform((value) => BigInt(value));
const nonnegativeStock = z.string().regex(/^\d+$/, "Stok minimum harus bilangan bulat nonnegatif.").max(19).refine((value) => BigInt(value) <= maxInteger).transform((value) => BigInt(value));
const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sellingPrice: money,
  minimumStock: nonnegativeStock,
  continueSimilarName: z.boolean().optional().default(false),
});

function serviceError(error: unknown) {
  if (!(error instanceof SparePartServiceError)) throw error;
  if (error.kind === "SIMILAR_NAME") {
    return NextResponse.json({ warning: error.message, similarParts: error.similarParts }, { status: 409 });
  }
  return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID_KEY" ? 400 : 409 });
}

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const parts = await listSpareParts(session.user.role);
  return NextResponse.json({ spareparts: parts });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data sparepart tidak valid." }, { status: 400 });
  try {
    const { continueSimilarName, ...input } = parsed.data;
    const part = await createSparePart(input, { id: auth.session!.user.id, username: auth.session!.user.username }, key, continueSimilarName);
    return NextResponse.json({ sparepart: { id: part.id.toString(), code: part.code, name: part.name } }, { status: 201 });
  } catch (error) {
    return serviceError(error);
  }
}
