import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { DateTimeInputError, parseWorkshopDateTime } from "@/server/datetime";
import { ExpenseServiceError, previewExpense } from "@/server/expense-service";

const bodySchema = z.object({ transactionAt: z.string(), items: z.array(z.object({ description: z.string(), quantity: z.string(), unitPrice: z.string() })), generalNote: z.string().optional(), externalReceiptNumber: z.string().optional() });
export async function POST(request: Request) { const auth = await requireAdmin(request); if (auth.response) return auth.response; const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Data Expense tidak valid." }, { status: 400 }); try { return NextResponse.json({ preview: previewExpense({ ...parsed.data, transactionAt: parseWorkshopDateTime(parsed.data.transactionAt) }) }); } catch (error) { if (error instanceof ExpenseServiceError || error instanceof DateTimeInputError) return NextResponse.json({ error: error.message }, { status: error instanceof ExpenseServiceError && error.kind === "FUTURE_DATE" ? 400 : 400 }); throw error; } }
