import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { updateUser, UserServiceError } from "@/server/user-service";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deactivate") }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("reset-password"), password: z.string().min(12).max(1024) }),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Perintah tidak valid." }, { status: 400 });
  try {
    const updated = await updateUser(BigInt(id), body.data, { id: auth.session!.user.id, username: auth.session!.user.username });
    return NextResponse.json({ user: { id: updated.id.toString(), username: updated.username, role: updated.role, isActive: updated.isActive, mustChangePassword: updated.mustChangePassword } });
  } catch (error) {
    if (error instanceof UserServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
