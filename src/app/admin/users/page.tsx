import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { UserManagementClient } from "@/components/user-management-client";

export default async function UserManagementPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  return <UserManagementClient currentUserId={session.user.id.toString()} />;
}
