import { NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookies } from "@/server/auth";
import { loginUser } from "@/server/auth-service";
import { backupMaintenanceActive } from "@/server/maintenance";

const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(1024) });

export async function POST(request: Request) {
  if (await backupMaintenanceActive()) return NextResponse.json({ error: "Aplikasi sedang memulihkan database. Coba kembali sebentar lagi." }, { status: 503 });
  const body = loginSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });

  const login = await loginUser(body.data.username, body.data.password);
  if (!login) return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  const response = NextResponse.json({
    user: { id: login.user.id.toString(), username: login.user.username, role: login.user.role, mustChangePassword: login.user.mustChangePassword },
  });
  setSessionCookies(response, login.sessionToken, login.csrfToken, request);
  return response;
}
