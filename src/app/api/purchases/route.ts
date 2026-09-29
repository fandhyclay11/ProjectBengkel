import { NextResponse } from "next/server";
import { currentSession } from "@/server/auth";
import { listPurchases } from "@/server/purchase-service";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  return NextResponse.json({ purchases: await listPurchases(session.user.role) });
}
