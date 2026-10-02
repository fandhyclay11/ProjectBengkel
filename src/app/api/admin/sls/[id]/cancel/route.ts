import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { SlsServiceError, cancelSls } from "@/server/sls-service";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ reason: z.string().max(1000) });

export async function POST(request: Request, context: Context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const rawId = (await context.params).id;
  if (!/^\d{1,19}$/.test(rawId) || BigInt(rawId) <= 0n) return NextResponse.json({ error: "SLS tidak ditemukan." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Alasan pembatalan tidak valid." }, { status: 400 });
  try { return NextResponse.json({ sls: await cancelSls(BigInt(rawId), parsed.data.reason, { id: auth.session!.user.id, username: auth.session!.user.username }, key) }); }
  catch (error) { if (error instanceof SlsServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "INVALID" ? 400 : error.kind === "STATE_CONFLICT" ? 409 : 404 }); throw error; }
}
