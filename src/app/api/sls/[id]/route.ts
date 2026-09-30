import { NextResponse } from "next/server";
import { currentSession } from "@/server/auth";
import { getSls } from "@/server/sls-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const value = (await context.params).id;
  if (!/^\d+$/.test(value)) return NextResponse.json({ error: "SLS tidak ditemukan." }, { status: 404 });
  const sls = await getSls(BigInt(value), session.user.role);
  return sls ? NextResponse.json({ sls }) : NextResponse.json({ error: "SLS tidak ditemukan." }, { status: 404 });
}
