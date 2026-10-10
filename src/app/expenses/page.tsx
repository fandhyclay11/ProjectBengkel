import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { listExpenses } from "@/server/expense-service";
import { workshopDateTimeInput } from "@/server/datetime";
import { ExpensesClient } from "@/components/expenses-client";
export default async function ExpensesPage() { const session = await currentSession(); if (!session) redirect("/"); if (session.user.mustChangePassword) redirect("/ganti-password"); if (session.user.role !== "ADMIN") redirect("/beranda"); const today = workshopDateTimeInput(new Date()).slice(0, 10); return <ExpensesClient initialExpenses={await listExpenses(today, false)} initialCanceled={await listExpenses(today, true)} defaultDateTime={workshopDateTimeInput(new Date())} defaultExpenseDate={today} />; }
