"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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

  return <section className="w-full rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
    <h1 className="text-2xl font-semibold">Project Bengkel</h1>
    <p className="mt-2 text-sm text-slate-600">Masuk dengan akun lokal yang diberikan Admin.</p>
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium">Username<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" name="username" autoComplete="username" required maxLength={80} /></label>
      <label className="block text-sm font-medium">Password<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button className="w-full rounded-md bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-60" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
    </form>
  </section>;
}
