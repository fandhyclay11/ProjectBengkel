import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, hasValidCsrf } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime, workshopDateTimeInput } from "@/server/datetime";
import { createService, listServices, ServiceServiceError } from "@/server/service-service";

const max = 9_223_372_036_854_775_807n;
const integer = z.string().regex(/^\d+$/).max(19).transform((value) => BigInt(value)).refine((value) => value <= max);
const schema = z.object({
  transactionAt: z.string(), vehicleDescription: z.string().max(200).optional(), discount: integer,
  jobs: z.array(z.object({ description: z.string().max(300), amount: integer })),
  items: z.array(z.object({ sparePartId: integer, quantity: integer, sellingPrice: integer.optional() })),
});

function failure(error: unknown) {
  if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof ServiceServiceError) {
    const status = error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : error.kind === "INSUFFICIENT_STOCK" || error.kind === "STATE_CONFLICT" || error.kind === "IDEMPOTENCY_CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}

async function authenticated(request: Request) {
  const session = await currentSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 }) };
  if (session.user.mustChangePassword) return { session: null, response: NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 }) };
  if (!(await hasValidCsrf(request, session))) return { session: null, response: NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 }) };
  return { session, response: null };
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.user.mustChangePassword) return NextResponse.json({ error: "Ganti password sebelum melanjutkan." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? workshopDateTimeInput(new Date()).slice(0, 10);
  try {
    return NextResponse.json({ services: await listServices(session.user.role, date) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const auth = await authenticated(request);
  if (auth.response) return auth.response;
  const key = request.headers.get("idempotency-key");
  if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data Service tidak valid." }, { status: 400 });
  try {
    const service = await createService({ ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }, { id: auth.session!.user.id, username: auth.session!.user.username }, key, auth.session!.user.role);
    return NextResponse.json({ service }, { status: 201 });
  } catch (error) { return failure(error); }
}
