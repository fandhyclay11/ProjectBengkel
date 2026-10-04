"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken() { return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("pb_csrf="))?.slice(8) ?? ""; }

export function LogoutButton() {
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

  return <div className="flex flex-col items-end gap-1"><button type="button" disabled={busy} onClick={() => void logout()} className="rounded border px-3 py-2 disabled:opacity-50">{busy ? "Keluar…" : "Logout"}</button>{error && <p role="alert" className="max-w-xs text-right text-sm text-red-700">{error}</p>}</div>;
}
