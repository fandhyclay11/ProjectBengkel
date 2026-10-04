import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopTimezone } from "@/server/datetime";
import { DashboardClient } from "@/components/dashboard-client";

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  return <DashboardClient workshopName={process.env.APP_WORKSHOP_NAME?.trim() || "Project Bengkel"} timezone={workshopTimezone()} />;
}
