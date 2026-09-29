import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { deleteAuditEvent, listAuditEvents } from "@/server/audit";

const deleteSchema = z.object({ id: z.string().regex(/^\d+$/) });

export async function GET(request: Request) {
  const auth = await requireAdmin(request, false);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
  const cursor = url.searchParams.get("before");
  if (cursor && !/^\d+$/.test(cursor)) return NextResponse.json({ error: "Cursor audit tidak valid." }, { status: 400 });
  return NextResponse.json({ entries: await listAuditEvents(limit, cursor ? BigInt(cursor) : undefined) });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "ID audit tidak valid." }, { status: 400 });
  const deleted = await deleteAuditEvent(BigInt(body.data.id), { id: auth.session!.user.id, username: auth.session!.user.username });
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Audit tidak ditemukan." }, { status: 404 });
}
