import { NextResponse } from "next/server";
import { currentSession } from "@/server/auth";
import { getPurchase } from "@/server/purchase-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const value = (await context.params).id;
  if (!/^\d+$/.test(value)) return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  const purchase = await getPurchase(BigInt(value), session.user.role);
  if (!purchase) return NextResponse.json({ error: "Purchase tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ purchase });
}
