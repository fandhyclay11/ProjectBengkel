import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { SparePartsClient } from "@/components/spareparts-client";
import { listSpareParts } from "@/server/sparepart-service";

export default async function SparePartsPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  const spareparts = await listSpareParts(session.user.role);
  return <SparePartsClient role={session.user.role} initialParts={spareparts} />;
}
