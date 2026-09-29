import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { createUser, listUsers } from "@/server/user-service";

const createSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(12).max(1024), role: z.enum(["ADMIN", "USER"]) });

export async function GET(request: Request) {
  const auth = await requireAdmin(request, false);
  if (auth.response) return auth.response;
  const users = await listUsers();
  return NextResponse.json({ users: users.map((user) => ({ ...user, id: user.id.toString() })) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Data user tidak valid." }, { status: 400 });
  try {
    const user = await createUser(body.data, { id: auth.session!.user.id, username: auth.session!.user.username });
    return NextResponse.json({ user: { id: user.id.toString(), username: user.username, role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Username sudah digunakan." }, { status: 409 });
    throw error;
  }
}
