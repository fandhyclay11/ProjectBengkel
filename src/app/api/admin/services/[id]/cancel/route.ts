import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ServiceServiceError, cancelService } from "@/server/service-service";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ reason: z.string().max(1000) });

export async function POST(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const rawId = (await context.params).id;
  if (!/^\d{1,19}$/.test(rawId) || BigInt(rawId) <= 0n) return NextResponse.json({ error: "Service tidak ditemukan." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Alasan pembatalan tidak valid." }, { status: 400 });
  try { return NextResponse.json({ service: await cancelService(BigInt(rawId), parsed.data.reason, { id: auth.session!.user.id, username: auth.session!.user.username }, key) }); }
  catch (error) { if (error instanceof ServiceServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" ? 400 : 409 }); throw error; }
}
