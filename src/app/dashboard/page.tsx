import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopTimezone } from "@/server/datetime";
import { DashboardClient } from "@/components/dashboard-client";
import { AppShell } from "@/components/app-shell";

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  return <AppShell role={session.user.role} username={session.user.username} title="Dashboard"><DashboardClient workshopName={process.env.APP_WORKSHOP_NAME?.trim() || "BIMANTARA MOTOR INDONESIA"} timezone={workshopTimezone()} /></AppShell>;
}
