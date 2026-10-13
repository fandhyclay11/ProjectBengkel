"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken() { return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("pb_csrf="))?.slice(8) ?? ""; }

export function LogoutButton({ onBrandBackground = false }: { onBrandBackground?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const logout = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrfToken() } });
      const result = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" && result.error ? result.error : "Logout gagal. Silakan coba lagi.");
      router.replace("/"); router.refresh();
    } catch (reason) {
      setError(reason instanceof TypeError ? "Koneksi gagal. Logout belum berhasil. Silakan coba lagi." : reason instanceof Error ? reason.message : "Logout gagal. Silakan coba lagi.");
      setBusy(false);
    }
  };

  return <div className="flex flex-col items-end gap-1"><button type="button" disabled={busy} onClick={() => void logout()} className={`rounded border px-3 py-2 disabled:opacity-50 ${onBrandBackground ? "border-[rgba(143,16,24,0.35)] bg-white/70 text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[#fffdf8]" : ""}`}>{busy ? "Keluar…" : "Logout"}</button>{error && <p role="alert" className={`max-w-xs text-right text-sm ${onBrandBackground ? "font-medium text-[var(--color-error)]" : "text-red-700"}`}>{error}</p>}</div>;
}
