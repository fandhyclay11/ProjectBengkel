import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { workshopDateTimeInput } from "@/server/datetime";
import { listSls } from "@/server/sls-service";
import { listSpareParts } from "@/server/sparepart-service";
import { SlsClient } from "@/components/sls-client";

export default async function SlsPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  const [sls, spareparts] = await Promise.all([listSls(session.user.role), listSpareParts(session.user.role)]);
  return <SlsClient role={session.user.role} initialSls={sls} spareparts={spareparts} defaultDateTime={workshopDateTimeInput(new Date())} />;
}
