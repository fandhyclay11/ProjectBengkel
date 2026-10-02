import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { listExpenses } from "@/server/expense-service";
export async function GET(request: Request) { const auth = await requireAdmin(request, false); if (auth.response) return auth.response; return NextResponse.json({ expenses: await listExpenses(true) }); }
