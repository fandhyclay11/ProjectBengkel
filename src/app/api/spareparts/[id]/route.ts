import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, requireAdmin } from "@/server/auth";
import { deleteSparePart, SparePartServiceError, updateSparePart } from "@/server/sparepart-service";
import { findSparePart } from "@/server/sparepart-repository";

const maxInteger = 9_223_372_036_854_775_807n;
const money = z.string().regex(/^-?\d+$/).max(20).refine((value) => {
  const amount = BigInt(value);
  return amount >= -9_223_372_036_854_775_808n && amount <= maxInteger;
}).transform((value) => BigInt(value));
const nonnegativeStock = z.string().regex(/^\d+$/).max(19).refine((value) => BigInt(value) <= maxInteger).transform((value) => BigInt(value));
const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  sellingPrice: money.optional(),
  minimumStock: nonnegativeStock.optional(),
  isActive: z.boolean().optional(),
  continueSimilarName: z.boolean().optional().default(false),
}).refine(({ name, sellingPrice, minimumStock, isActive }) =>
  name !== undefined || sellingPrice !== undefined || minimumStock !== undefined || isActive !== undefined,
);

type Context = { params: Promise<{ id: string }> };
function parseId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}
function serviceError(error: unknown) {
  if (!(error instanceof SparePartServiceError)) throw error;
  if (error.kind === "SIMILAR_NAME") return NextResponse.json({ warning: error.message, similarParts: error.similarParts }, { status: 409 });
  return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID_KEY" ? 400 : 409 });
}

export async function GET(request: Request, context: Context) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Sparepart tidak ditemukan." }, { status: 404 });
  const part = await findSparePart(id);
  if (!part || (session.user.role === "USER" && !part.isActive)) return NextResponse.json({ error: "Sparepart tidak ditemukan." }, { status: 404 });
  const sparepart = session.user.role === "ADMIN"
    ? { id: part.id.toString(), code: part.code, name: part.name, sellingPrice: part.sellingPrice.toString(), latestBuyPrice: part.latestBuyPrice?.toString() ?? null, averageCost: part.averageCost?.toString() ?? null, currentStock: part.stockOnHand.toString(), minimumStock: part.minimumStock.toString(), isActive: part.isActive }
    : { id: part.id.toString(), code: part.code, name: part.name, currentStock: part.stockOnHand.toString() };
  return NextResponse.json({ sparepart });
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Sparepart tidak ditemukan." }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data sparepart tidak valid." }, { status: 400 });
  try {
    const { continueSimilarName, ...input } = parsed.data;
    const part = await updateSparePart(id, input, { id: auth.session!.user.id, username: auth.session!.user.username }, key, continueSimilarName);
    return NextResponse.json({ sparepart: { id: part.id.toString(), code: part.code, name: part.name, isActive: part.isActive } });
  } catch (error) {
    return serviceError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Sparepart tidak ditemukan." }, { status: 404 });
  try {
    const result = await deleteSparePart(id, { id: auth.session!.user.id, username: auth.session!.user.username }, key);
    return NextResponse.json(result);
  } catch (error) {
    return serviceError(error);
  }
}
