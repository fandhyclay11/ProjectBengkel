import { NextResponse } from "next/server";
import { requireAuth } from "@/server/stock-opname-auth";
import { getStockOpname } from "@/server/stock-opname-service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { const auth = await requireAuth(request); if (auth.response) return auth.response; const raw = (await context.params).id; if (!/^\d{1,19}$/.test(raw) || BigInt(raw) <= 0n) return NextResponse.json({ error: "Stock Opname tidak ditemukan." }, { status: 404 }); const stockOpname = await getStockOpname(BigInt(raw), auth.session!.user.role); return stockOpname ? NextResponse.json({ stockOpname }) : NextResponse.json({ error: "Stock Opname tidak ditemukan." }, { status: 404 }); }
