"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("newPassword") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) { setError("Password baru dan konfirmasi tidak sama."); setBusy(false); return; }
    const csrfResponse = await fetch("/api/auth/session");
    const csrfData = await csrfResponse.json() as { csrfToken?: string };
    const response = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfData.csrfToken ?? "" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: password }) });
    if (!response.ok) { const result = await response.json().catch(() => null) as { error?: string } | null; setError(result?.error ?? "Password tidak dapat diubah."); setBusy(false); return; }
    setMessage("Password berubah. Silakan masuk kembali.");
    router.replace("/"); router.refresh();
  }
  return <section className="w-full rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
    <h1 className="text-2xl font-semibold">Ganti password</h1>
    <p className="mt-2 text-sm text-slate-600">Gunakan password baru minimal 12 karakter.</p>
    <form className="mt-7 space-y-4" onSubmit={submit}>
      {!mustChange && <label className="block text-sm font-medium">Password saat ini<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" type="password" name="currentPassword" autoComplete="current-password" required /></label>}
      <label className="block text-sm font-medium">Password baru<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" type="password" name="newPassword" autoComplete="new-password" minLength={12} required /></label>
      <label className="block text-sm font-medium">Ulangi password baru<input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" type="password" name="confirmPassword" autoComplete="new-password" minLength={12} required /></label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}{message && <p className="text-sm text-green-700" role="status">{message}</p>}
      <button className="w-full rounded-md bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-60" disabled={busy}>{busy ? "Menyimpan…" : "Simpan password"}</button>
    </form>
  </section>;
}
