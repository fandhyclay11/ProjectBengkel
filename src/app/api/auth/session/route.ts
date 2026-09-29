import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentSession, CSRF_COOKIE } from "@/server/auth";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const jar = await cookies();
  return NextResponse.json({
    user: { id: session.user.id.toString(), username: session.user.username, role: session.user.role, mustChangePassword: session.user.mustChangePassword },
    csrfToken: jar.get(CSRF_COOKIE)?.value ?? null,
  });
}
