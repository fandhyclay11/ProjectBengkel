import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { LoginForm } from "@/components/login-form";

export default async function HomePage() {
  const session = await currentSession();
  if (session) redirect(session.user.mustChangePassword ? "/ganti-password" : "/beranda");
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-5 py-12"><LoginForm /></main>;
}
