import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { AppShell } from "@/components/app-shell";
import { getDashboard } from "@/server/dashboard-query-service";
import { BerandaOperationalSummary } from "@/components/beranda-operational-summary";

export default async function HomeDashboardPlaceholder() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  let dashboard;
  let dashboardError = false;
  if (session.user.role === "ADMIN") {
    try { dashboard = await getDashboard("ADMIN", { preset: "month" }); } catch { dashboardError = true; }
  }
  return <AppShell role={session.user.role} username={session.user.username} title="Beranda"><BerandaOperationalSummary role={session.user.role} dashboard={dashboard} dashboardError={dashboardError} /></AppShell>;
}
