import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateTimeInput, workshopTimezone } from "@/server/datetime";
import { ReportsClient } from "@/components/reports-client";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  const today = workshopDateTimeInput(new Date()).slice(0, 10);
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  return <ReportsClient defaultFrom={value("from") ?? today.slice(0, 8) + "01"} defaultTo={value("to") ?? today} initialReport={value("report")} workshopName={process.env.APP_WORKSHOP_NAME?.trim() || "Project Bengkel"} timezone={workshopTimezone()} />;
}
