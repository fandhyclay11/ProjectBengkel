import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateRange, workshopDateTimeInput } from "@/server/datetime";
import { listStockOpnames } from "@/server/stock-opname-service";
import { StockOpnameClient } from "@/components/stock-opname-client";
import { AppShell } from "@/components/app-shell";
export default async function StockOpnamePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) { const session = await currentSession(); if (!session) redirect("/"); if (session.user.mustChangePassword) redirect("/ganti-password"); const date = (await searchParams).date ?? workshopDateTimeInput(new Date()).slice(0, 10); const range = workshopDateRange(date, date); return <AppShell role={session.user.role} username={session.user.username} title="Stock Opname"><StockOpnameClient role={session.user.role} initialOpnames={await listStockOpnames(session.user.role, { createdFrom: range.from, createdToExclusive: range.toExclusive })} defaultDateTime={workshopDateTimeInput(new Date())} initialDate={date} /></AppShell>; }
