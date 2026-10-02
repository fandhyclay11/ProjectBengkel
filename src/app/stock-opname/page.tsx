import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateTimeInput } from "@/server/datetime";
import { listStockOpnames } from "@/server/stock-opname-service";
import { StockOpnameClient } from "@/components/stock-opname-client";
export default async function StockOpnamePage() { const session = await currentSession(); if (!session) redirect("/"); if (session.user.mustChangePassword) redirect("/ganti-password"); return <StockOpnameClient role={session.user.role} initialOpnames={await listStockOpnames(session.user.role)} defaultDateTime={workshopDateTimeInput(new Date())} />; }
