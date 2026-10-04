"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type User = { id: string; username: string; role: "ADMIN" | "USER"; isActive: boolean; mustChangePassword: boolean };
type Action = "activate" | "deactivate" | "reset-password";

function csrfToken() { return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("pb_csrf="))?.slice(8) ?? ""; }
function safeError(result: { error?: unknown }, fallback: string) { return typeof result.error === "string" && result.error ? result.error : fallback; }

export function UserManagementClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]); const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch("/api/admin/users", { cache: "no-store" }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(safeError(result, response.status === 401 ? "Sesi Anda telah berakhir. Silakan login kembali." : "Daftar user tidak dapat dimuat.")); setUsers(result.users as User[]); }
    catch (reason) { setError(reason instanceof TypeError ? "Koneksi gagal. Periksa koneksi lalu coba lagi." : (reason as Error).message || "Daftar user tidak dapat dimuat."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadUsers(), 0); return () => window.clearTimeout(timer); }, [loadUsers]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); setError("");
    const trimmedUsername = username.trim();
    if (!trimmedUsername) { setError("Username wajib diisi."); return; }
    if (password.length < 12) { setError("Password minimal 12 karakter."); return; }
    if (password !== confirmPassword) { setError("Password dan konfirmasi password tidak sama."); return; }
    setCreating(true);
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken() }, body: JSON.stringify({ username: trimmedUsername, password, role: "USER" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(safeError(result, response.status === 403 ? "Anda tidak memiliki izin untuk melakukan aksi ini." : "User gagal dibuat."));
      setUsername(""); setPassword(""); setConfirmPassword(""); setMessage("USER berhasil dibuat."); await loadUsers();
    } catch (reason) { setError(reason instanceof TypeError ? "Koneksi gagal. Periksa koneksi lalu coba lagi." : (reason as Error).message || "User gagal dibuat."); }
    finally { setCreating(false); }
  };

  const update = async (user: User, action: Action) => {
    setMessage(""); setError("");
    if (action === "deactivate" && user.id === currentUserId) { setError("Anda tidak dapat menonaktifkan akun Anda sendiri."); return; }
    if (action === "deactivate" && user.role === "ADMIN") { setError("Akun Admin lain tidak dapat dinonaktifkan."); return; }
    let passwordValue = "";
    if (action === "reset-password") {
      const nextPassword = window.prompt(`Password baru untuk ${user.username} (minimal 12 karakter):`);
      if (nextPassword === null) return;
      if (nextPassword.length < 12) { setError("Password minimal 12 karakter."); return; }
      const confirmation = window.prompt("Ulangi password baru:");
      if (confirmation === null) return;
      if (nextPassword !== confirmation) { setError("Password dan konfirmasi password tidak sama."); return; }
      if (!window.confirm(`Reset password ${user.username}? User wajib mengganti password saat login berikutnya.`)) return;
      passwordValue = nextPassword;
    } else if (!window.confirm(`${action === "activate" ? "Aktifkan" : "Nonaktifkan"} user ${user.username}?`)) return;
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrfToken() }, body: JSON.stringify(action === "reset-password" ? { action, password: passwordValue } : { action }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(safeError(result, response.status === 401 ? "Sesi Anda telah berakhir. Silakan login kembali." : response.status === 403 ? "Anda tidak memiliki izin untuk melakukan aksi ini." : "Aksi gagal. Silakan coba lagi."));
      setMessage(action === "reset-password" ? "Password berhasil direset. User wajib mengganti password saat login berikutnya." : action === "activate" ? "User berhasil diaktifkan." : "User berhasil dinonaktifkan."); await loadUsers();
    } catch (reason) { setError(reason instanceof TypeError ? "Koneksi gagal. Periksa koneksi lalu coba lagi." : (reason as Error).message || "Aksi gagal. Silakan coba lagi."); }
    finally { setBusyId(null); }
  };

  return <main className="mx-auto max-w-6xl p-6"><a href="/beranda" className="text-sm text-blue-700">← Beranda</a><h1 className="mt-3 text-2xl font-semibold">Manajemen User</h1><p className="mt-2 text-sm text-slate-600">Kelola akun USER tanpa menampilkan password.</p>{message && <p role="status" className="my-3 rounded bg-green-50 p-3 text-green-800">{message}</p>}{error && <p role="alert" className="my-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}<section className="my-5 rounded border bg-white p-4"><h2 className="font-semibold">Tambah USER</h2><form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={(event) => void create(event)}><label className="grid gap-1 text-sm">Username<input className="rounded border px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" /></label><label className="grid gap-1 text-sm">Password awal<input className="rounded border px-3 py-2" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><label className="grid gap-1 text-sm">Konfirmasi password<input className="rounded border px-3 py-2" type="password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label><button disabled={creating} className="self-end rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{creating ? "Membuat USER…" : "Buat USER"}</button></form><p className="mt-2 text-xs text-slate-500">Role otomatis USER. Password minimal 12 karakter.</p></section><section className="rounded border bg-white p-4"><h2 className="font-semibold">Daftar User</h2>{loading ? <p className="mt-3">Memuat daftar user…</p> : error && !users.length ? <div className="mt-3"><p className="text-sm text-red-700">Daftar user tidak dapat dimuat.</p><button onClick={() => void loadUsers()} className="mt-2 rounded border px-3 py-2">Coba lagi</button></div> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-100"><tr><th className="px-3 py-2">Username</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t"><td className="px-3 py-3">{user.username}</td><td className="px-3 py-3">{user.role}</td><td className="px-3 py-3">{user.isActive ? "Aktif" : "Nonaktif"}{user.mustChangePassword && <span className="ml-2 text-xs text-amber-700">Wajib ganti password</span>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{user.role === "USER" && <button disabled={busyId === user.id} onClick={() => void update(user, "reset-password")} className="rounded border px-3 py-1 disabled:opacity-50">Reset password</button>}{user.role === "USER" && user.isActive && user.id !== currentUserId && <button disabled={busyId === user.id} onClick={() => void update(user, "deactivate")} className="rounded border border-red-300 px-3 py-1 text-red-800 disabled:opacity-50">Nonaktifkan</button>}{user.role === "USER" && !user.isActive && <button disabled={busyId === user.id} onClick={() => void update(user, "activate")} className="rounded border px-3 py-1 disabled:opacity-50">Aktifkan</button>}{busyId === user.id && <span className="py-1 text-xs text-slate-500">Memproses…</span>}</div></td></tr>)}</tbody></table>{!users.length && <p className="p-4 text-slate-600">Belum ada USER.</p>}</div>}</section></main>;
}
