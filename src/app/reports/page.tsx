import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateTimeInput, workshopTimezone } from "@/server/datetime";
import { ReportsClient } from "@/components/reports-client";

export default async function ReportsPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  const today = workshopDateTimeInput(new Date()).slice(0, 10);
  return <ReportsClient defaultFrom={today.slice(0, 8) + "01"} defaultTo={today} workshopName={process.env.APP_WORKSHOP_NAME?.trim() || "Project Bengkel"} timezone={workshopTimezone()} />;
}
