import { NextResponse } from "next/server";
import { currentSession } from "@/server/auth";
import { DateTimeInputError, workshopDateTimeInput } from "@/server/datetime";
import { listPurchases } from "@/server/purchase-service";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? workshopDateTimeInput(new Date()).slice(0, 10);
  try {
    return NextResponse.json({ purchases: await listPurchases(session.user.role, date) });
  } catch (error) {
    if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
