import { NextResponse } from "next/server";
import { currentSession, clearSessionCookies, hasValidCsrf } from "@/server/auth";
import { prisma } from "@/server/db";

export async function POST(request: Request) {
  const session = await currentSession();
  if (session && !(await hasValidCsrf(request, session))) {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 });
  }
  if (session) await prisma.session.deleteMany({ where: { id: session.id } });
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response, request);
  return response;
}
