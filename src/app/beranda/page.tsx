import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";

export default async function HomeDashboardPlaceholder() {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  return <main className="mx-auto max-w-4xl p-8"><h1 className="text-2xl font-semibold">Project Bengkel</h1><p className="mt-3 text-slate-600">Login sebagai {session.user.role}.</p><div className="mt-6 flex flex-wrap gap-3"><a className="rounded bg-blue-700 px-4 py-2 text-white" href="/spareparts">Daftar Sparepart</a><a className="rounded border px-4 py-2" href="/purchases">Purchase</a>{session.user.role === "ADMIN" && <a className="rounded border px-4 py-2" href="/stock-card">Kartu Stok</a>}</div></main>;
}
