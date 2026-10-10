import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { listSpareParts } from "@/server/sparepart-service";
import { listPurchases } from "@/server/purchase-service";
import { workshopDateTimeInput } from "@/server/datetime";
import { PurchasesClient } from "@/components/purchases-client";

export default async function PurchasesPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  const today = workshopDateTimeInput(new Date()).slice(0, 10);
  const purchases = await listPurchases(session.user.role, today);
  const spareparts = session.user.role === "ADMIN" ? await listSpareParts("ADMIN") : [];
  return <PurchasesClient role={session.user.role} initialPurchases={purchases} spareparts={spareparts} defaultDateTime={workshopDateTimeInput(new Date())} defaultPurchaseDate={today} />;
}
