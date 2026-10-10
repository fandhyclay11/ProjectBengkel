import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, workshopDateTimeInput } from "@/server/datetime";
import { listExpenses } from "@/server/expense-service";
export async function GET(request: Request) { const auth = await requireAdmin(request, false); if (auth.response) return auth.response; const date = new URL(request.url).searchParams.get("date") ?? workshopDateTimeInput(new Date()).slice(0, 10); try { return NextResponse.json({ expenses: await listExpenses(date, true) }); } catch (error) { if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 }); throw error; } }
