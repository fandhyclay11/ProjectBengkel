import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function ChangePasswordPage() {
  const session = await currentSession();
  if (!session) redirect("/");
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-5 py-12"><ChangePasswordForm mustChange={session.user.mustChangePassword} /></main>;
}
