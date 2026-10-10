import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime, workshopDateTimeInput } from "@/server/datetime";
import { createExpense, ExpenseServiceError, listExpenses } from "@/server/expense-service";

const bodySchema = z.object({ transactionAt: z.string(), items: z.array(z.object({ description: z.string(), quantity: z.string(), unitPrice: z.string() })), generalNote: z.string().optional(), externalReceiptNumber: z.string().optional() });
function failure(error: unknown) { if (error instanceof ExpenseServiceError) return NextResponse.json({ error: error.message }, { status: error.kind === "NOT_FOUND" ? 404 : error.kind === "INVALID" || error.kind === "FUTURE_DATE" ? 400 : 409 }); if (error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: 400 }); throw error; }

export async function GET(request: Request) { const auth = await requireAdmin(request, false); if (auth.response) return auth.response; const date = new URL(request.url).searchParams.get("date") ?? workshopDateTimeInput(new Date()).slice(0, 10); try { return NextResponse.json({ expenses: await listExpenses(date, false) }); } catch (error) { return failure(error); } }
export async function POST(request: Request) { const auth = await requireAdmin(request); if (auth.response) return auth.response; const key = request.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Kunci permintaan wajib disertakan." }, { status: 400 }); const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Data Expense tidak valid." }, { status: 400 }); try { const expense = await createExpense({ ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }, { id: auth.session!.user.id, username: auth.session!.user.username }, key); return NextResponse.json({ expense }, { status: 201 }); } catch (error) { return failure(error); } }
