import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, hasValidCsrf } from "@/server/auth";
import { changeOwnPassword } from "@/server/auth-service";

const passwordSchema = z.object({ currentPassword: z.string().max(1024).optional(), newPassword: z.string().min(12).max(1024) });

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!(await hasValidCsrf(request, session))) return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 });
  const body = passwordSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Password baru tidak valid." }, { status: 400 });
  const changed = await changeOwnPassword({ userId: session.user.id, username: session.user.username, mustChangePassword: session.user.mustChangePassword, currentPassword: body.data.currentPassword, newPassword: body.data.newPassword });
  if (!changed) return NextResponse.json({ error: "Password saat ini salah." }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Password berhasil diubah. Silakan login kembali." });
}
