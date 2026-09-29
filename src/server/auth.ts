import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { backupMaintenanceActive } from "@/server/maintenance";

export const SESSION_COOKIE = "pb_session";
export const CSRF_COOKIE = "pb_csrf";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function currentSession() {
  if (await backupMaintenanceActive()) return null;
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { id: true, username: true, role: true, isActive: true, mustChangePassword: true, sessionVersion: true } } },
  });
  if (!session) return null;
  if (
    session.expiresAt <= new Date() ||
    !session.user.isActive ||
    session.user.sessionVersion !== session.userSessionVersion
  ) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session;
}

export type AppSession = NonNullable<Awaited<ReturnType<typeof currentSession>>>;

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function hasValidCsrf(request: Request, session: AppSession): Promise<boolean> {
  if (!isSameOrigin(request)) return false;
  const header = request.headers.get("x-csrf-token");
  const jar = await cookies();
  const cookie = jar.get(CSRF_COOKIE)?.value;
  return Boolean(
    header && cookie && header === cookie && hashToken(header) === session.csrfTokenHash,
  );
}

export async function requireAdmin(request: Request, requireCsrf = true) {
  const session = await currentSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 }) };
  if (session.user.mustChangePassword) {
    return { session: null, response: NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 }) };
  }
  if (session.user.role !== "ADMIN") {
    return { session: null, response: NextResponse.json({ error: "Akses ditolak." }, { status: 403 }) };
  }
  if (requireCsrf && !(await hasValidCsrf(request, session))) {
    return { session: null, response: NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 }) };
  }
  return { session, response: null };
}

export function setSessionCookies(response: NextResponse, sessionToken: string, csrfToken: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    expires,
  });
  response.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export function clearSessionCookies(response: NextResponse, request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    response.cookies.set(name, "", { httpOnly: name === SESSION_COOKIE, secure, sameSite: "strict", path: "/", maxAge: 0 });
  }
}

export const sessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);
