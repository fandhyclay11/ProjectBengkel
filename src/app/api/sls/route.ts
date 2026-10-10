import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, hasValidCsrf } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime, workshopDateTimeInput } from "@/server/datetime";
import { createSls, listSls, SlsServiceError } from "@/server/sls-service";

const max = 9_223_372_036_854_775_807n;
const integer = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value <= max);
const schema = z.object({ transactionAt: z.string(), discount: integer, items: z.array(z.object({ sparePartId: integer, quantity: integer, sellingPrice: integer.optional() })) });

function failure(error: unknown) {
  if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof SlsServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409 });
  throw error;
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? workshopDateTimeInput(new Date()).slice(0, 10);
  try {
    return NextResponse.json({ sls: await listSls(session.user.role, date) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  if (!(await hasValidCsrf(request, session))) return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 });
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data SLS tidak valid." }, { status: 400 });
  try {
    const sls = await createSls({ ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }, { id: session.user.id, username: session.user.username }, key, session.user.role);
    return NextResponse.json({ sls }, { status: 201 });
  } catch (error) { return failure(error); }
}
