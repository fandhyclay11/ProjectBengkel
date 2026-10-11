"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      if (!response.ok) throw new Error("Username atau password salah.");
      const result = await response.json() as { user: { mustChangePassword: boolean } };
      router.replace(result.user.mustChangePassword ? "/ganti-password" : "/beranda");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-lg shadow-red-950/10 sm:p-8">
    <div className="flex flex-col items-center text-center">
      <Image className="h-auto max-h-28 w-full max-w-[18rem] object-contain" src="/brand/bimantara-motor-indonesia.jpg" alt="BIMANTARA MOTOR INDONESIA" width={288} height={112} priority />
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-black sm:text-3xl">BIMANTARA MOTOR INDONESIA</h1>
      <p className="mt-2 text-sm text-slate-600">Masuk dengan akun lokal yang diberikan Admin.</p>
    </div>
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium">Username<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" name="username" autoComplete="username" required maxLength={80} /></label>
      <label className="block text-sm font-medium">Password<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-60" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
    </form>
  </section>;
}
