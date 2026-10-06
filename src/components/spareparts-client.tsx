"use client";

import { useCallback, useRef, useState } from "react";

type AdminPart = { id: string; code: string; name: string; sellingPrice: string; latestBuyPrice: string | null; averageCost: string | null; currentStock: string; minimumStock: string; isActive: boolean };
type UserPart = { id: string; code: string; name: string; currentStock: string };
type Part = AdminPart | UserPart;
const isAdminPart = (part: Part): part is AdminPart => "sellingPrice" in part;
const formatMoney = (value: string) => `Rp${BigInt(value).toLocaleString("id-ID")}`;
const formatMargin = (part: AdminPart) => part.latestBuyPrice === null || BigInt(part.sellingPrice) === 0n
  ? "—"
  : `${((BigInt(part.sellingPrice) - BigInt(part.latestBuyPrice)) * 100n / BigInt(part.sellingPrice)).toString()}%`;

function csrfToken() {
  return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pb_csrf="))?.slice("pb_csrf=".length) ?? "";
}

async function send(url: string, method: string, body?: unknown, idempotencyKey = crypto.randomUUID()) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken(), "idempotency-key": idempotencyKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error ?? result.warning ?? "Permintaan gagal.") as Error & { similarParts?: Array<{ code: string; name: string }> };
    error.similarParts = result.similarParts;
    throw error;
  }
  return result;
}

function AdminPartRow({ part, refresh, announce }: { part: AdminPart; refresh: () => Promise<void>; announce: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(part.name);
  const [sellingPrice, setSellingPrice] = useState(part.sellingPrice);
  const [minimumStock, setMinimumStock] = useState(part.minimumStock);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingUnitCost, setOpeningUnitCost] = useState("");
  const editKey = useRef<string | null>(null);
  const openingKey = useRef<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);

  const save = async (continueSimilarName = false) => {
    editKey.current ??= crypto.randomUUID();
    setSaving(true);
    try {
      await send(`/api/spareparts/${part.id}`, "PATCH", { name, sellingPrice, minimumStock, continueSimilarName }, editKey.current);
      editKey.current = null;
      setEditing(false);
      announce("Perubahan sparepart tersimpan.");
      await refresh();
    } catch (error) {
      const err = error as Error & { similarParts?: Array<{ code: string; name: string }> };
      if (err.similarParts?.length) {
        const candidates = err.similarParts.map((item) => `${item.code} — ${item.name}`).join("\n");
        if (window.confirm(`${err.message}\n\n${candidates}\n\nLanjutkan perubahan nama ini?`)) await save(true);
      } else if (err.message === "Nama sparepart tersebut sudah digunakan.") announce(`Nama sparepart "${name.trim()}" sudah digunakan. Silakan gunakan nama lain.`);
      else announce(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeActive = async () => {
    setPendingAction(true);
    try { await send(`/api/spareparts/${part.id}`, "PATCH", { isActive: !part.isActive }); await refresh(); }
    catch (error) { announce((error as Error).message); }
    finally { setPendingAction(false); }
  };

  const recordOpening = async () => {
    openingKey.current ??= crypto.randomUUID();
    setPendingAction(true);
    try {
      await send("/api/admin/stock/opening", "POST", { sparePartId: part.id, quantity: openingQuantity, unitCost: openingUnitCost }, openingKey.current);
      openingKey.current = null;
      setOpening(false); setOpeningQuantity(""); setOpeningUnitCost("");
      announce("Stok berhasil dicatat.");
      await refresh();
    } catch (error) { announce((error as Error).message); }
    finally { setPendingAction(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Keluarkan ${part.name} dari daftar aktif? Histori tetap disimpan.`)) return;
    setPendingAction(true);
    try { await send(`/api/spareparts/${part.id}`, "DELETE"); await refresh(); }
    catch (error) { announce((error as Error).message); }
    finally { setPendingAction(false); }
  };

  return <tr className="border-t border-slate-200 align-top">
    <td className="px-3 py-3 font-mono text-sm">{part.code}</td>
    <td className="px-3 py-3">
      {editing ? <div className="grid gap-2">
        <input aria-label={`Nama ${part.code}`} className="rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label={`Harga jual ${part.code}`} className="rounded border px-2 py-1" inputMode="numeric" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
        <input aria-label={`Stok minimum ${part.code}`} className="rounded border px-2 py-1" inputMode="numeric" value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
      </div> : <>{part.name}<div className="mt-1 text-xs text-slate-500">{part.isActive ? "Aktif" : "Nonaktif"}</div></>}
    </td>
    <td className="px-3 py-3">{formatMoney(part.sellingPrice)}</td>
    <td className="px-3 py-3">{part.latestBuyPrice ? formatMoney(part.latestBuyPrice) : "Belum ada Purchase"}</td>
    <td className="px-3 py-3">{part.averageCost ? formatMoney(part.averageCost) : "—"}</td>
    <td className="px-3 py-3">{formatMargin(part)}</td>
    <td className="px-3 py-3">{part.currentStock}</td>
    <td className="px-3 py-3">{part.minimumStock}</td>
    <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
      {editing ? <>
        <button disabled={saving} className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50" onClick={() => void save()}>Simpan</button>
        <button className="rounded border px-3 py-1" onClick={() => { setEditing(false); setName(part.name); setSellingPrice(part.sellingPrice); setMinimumStock(part.minimumStock); }}>Batal</button>
      </> : <>
        <button className="rounded border px-3 py-1" onClick={() => setEditing(true)}>Edit</button>
        <button className="rounded border px-3 py-1" onClick={() => setOpening((value) => !value)}>Input stok</button>
        <button disabled={pendingAction} className="rounded border px-3 py-1 disabled:opacity-50" onClick={() => void changeActive()}>{part.isActive ? "Nonaktifkan" : "Aktifkan"}</button>
        <button disabled={pendingAction} className="rounded border border-red-300 px-3 py-1 text-red-800 disabled:opacity-50" onClick={() => void remove()}>Hapus dari daftar</button>
        {opening && <div className="basis-full rounded border bg-slate-50 p-3">
          <p className="mb-2 font-medium">Stok berlaku langsung saat disimpan.</p>
          <div className="flex flex-wrap gap-2">
            <input aria-label={`Jumlah stok ${part.code}`} className="w-36 rounded border px-2 py-1" inputMode="numeric" placeholder="Jumlah pcs" value={openingQuantity} onChange={(e) => setOpeningQuantity(e.target.value)} />
            <input aria-label={`Biaya per barang ${part.code}`} className="w-48 rounded border px-2 py-1" inputMode="numeric" placeholder="Modal per barang (Rp)" value={openingUnitCost} onChange={(e) => setOpeningUnitCost(e.target.value)} />
            <button disabled={pendingAction} className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50" onClick={() => void recordOpening()}>Simpan stok</button>
          </div>
        </div>}
      </>}
    </div></td>
  </tr>;
}

export function SparePartsClient({ role, initialParts, initialFilter }: { role: "ADMIN" | "USER"; initialParts: Part[]; initialFilter?: string }) {
  const [parts, setParts] = useState<Part[]>(initialParts);
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [minimumStock, setMinimumStock] = useState("0");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const createKey = useRef<string | null>(null);
  const admin = role === "ADMIN";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/spareparts", { cache: "no-store" });
      if (response.ok) {
        const result = await response.json();
        setParts(result.spareparts);
      } else setMessage("Daftar sparepart tidak dapat dimuat.");
    } catch {
      setMessage("Koneksi gagal. Daftar sparepart belum dapat diperbarui.");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = async (continueSimilarName = false) => {
    createKey.current ??= crypto.randomUUID();
    setCreating(true);
    try {
      await send("/api/spareparts", "POST", { name, sellingPrice, minimumStock, continueSimilarName }, createKey.current);
      createKey.current = null;
      setName(""); setSellingPrice(""); setMinimumStock("0"); setMessage("Sparepart berhasil ditambahkan.");
      await refresh();
    } catch (error) {
      const err = error as Error & { similarParts?: Array<{ code: string; name: string }> };
      if (err.similarParts?.length) {
        const candidates = err.similarParts.map((item) => `${item.code} — ${item.name}`).join("\n");
        if (window.confirm(`${err.message}\n\n${candidates}\n\nTetap tambahkan sparepart ini?`)) await create(true);
      } else if (err.message === "Nama sparepart tersebut sudah digunakan.") setMessage(`Nama sparepart "${name.trim()}" sudah digunakan. Silakan gunakan nama lain.`);
      else setMessage(err.message);
    } finally {
      setCreating(false);
    }
  };

  const visibleParts = parts.filter((part) => initialFilter === "low" ? isAdminPart(part) && BigInt(part.currentStock) <= BigInt(part.minimumStock) : initialFilter === "minus" ? isAdminPart(part) && BigInt(part.currentStock) < 0n : true);
  return <main className="mx-auto max-w-6xl p-6">
    <h1 className="text-2xl font-semibold">Sparepart</h1>
    <p className="mt-2 text-sm text-slate-600">Stok terlihat sesuai hak akses. Harga master dan data biaya hanya ditampilkan kepada Admin.</p>
    {message && <p role="status" className="my-3 rounded bg-slate-100 p-3">{message}</p>}
    {admin && <section className="my-5 rounded border bg-white p-4">
      <h2 className="font-semibold">Tambah sparepart</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">Nama<input className="rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Harga jual master (Rupiah)<input className="rounded border px-3 py-2" inputMode="numeric" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Stok minimum (pcs)<input className="rounded border px-3 py-2" inputMode="numeric" value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} /></label>
        <button disabled={creating} className="self-end rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void create()}>Tambah</button>
      </div>
    </section>}
    {loading ? <p className="p-4">Memuat daftar…</p> : <div className="overflow-x-auto rounded border bg-white">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-slate-100"><tr>
          <th className="px-3 py-2">Kode</th><th className="px-3 py-2">Nama</th>
           {admin && <><th className="px-3 py-2">Harga jual</th><th className="px-3 py-2">Harga beli terakhir</th><th className="px-3 py-2">HPP Average</th><th className="px-3 py-2">Margin</th></>}
          <th className="px-3 py-2">Stok kini</th>{admin && <><th className="px-3 py-2">Stok minimum</th><th className="px-3 py-2">Aksi</th></>}
        </tr></thead>
        <tbody>{visibleParts.map((part) => isAdminPart(part) ? <AdminPartRow key={part.id} part={part} refresh={refresh} announce={setMessage} /> : <tr key={part.id} className="border-t"><td className="px-3 py-3 font-mono">{part.code}</td><td className="px-3 py-3">{part.name}</td><td className="px-3 py-3">{part.currentStock}</td></tr>)}</tbody>
      </table>
      {!visibleParts.length && <p className="p-4 text-slate-600">Belum ada sparepart pada filter ini.</p>}
    </div>}
  </main>;
}
