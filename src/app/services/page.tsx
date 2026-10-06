import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateTimeInput } from "@/server/datetime";
import { listServices } from "@/server/service-service";
import { listSpareParts } from "@/server/sparepart-service";
import { ServicesClient } from "@/components/services-client";

export default async function ServicesPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  const services = await listServices(session.user.role);
  const spareparts = (await listSpareParts(session.user.role)).filter((part) => !('isActive' in part) || part.isActive);
  return <ServicesClient role={session.user.role} initialServices={services} spareparts={spareparts} defaultDateTime={workshopDateTimeInput(new Date())} />;
}
