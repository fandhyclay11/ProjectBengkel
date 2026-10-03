"use client";

import { useState } from "react";

type Item = {
  sparePartId: string;
  code: string;
  name: string;
  systemStock: string;
  physicalStock: string | null;
  difference: string | null;
  capturedStockVersion: string;
  verifiedSystemStock?: string;
  verifiedStockVersion?: string;
  currentStockVersion?: string;
  lineNumber: number;
};
type Opname = {
  id: string;
  opnameNumber: string;
  transactionInput: string;
  transactionDisplay: string;
  status: "REVISION" | "FINALIZED" | "APPROVED";
  revisionNumber: number;
  items: Item[];
};

const csrf = () => document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("pb_csrf="))?.slice(8) ?? "";
async function mutate(url: string, method: string, body: unknown, key = crypto.randomUUID()) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": key }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Permintaan gagal.");
  return result;
}

export function StockOpnameClient({ role, initialOpnames, defaultDateTime }: { role: "ADMIN" | "USER"; initialOpnames: Opname[]; defaultDateTime: string }) {
  const [opnames, setOpnames] = useState(initialOpnames);
  const [selected, setSelected] = useState<Opname | null>(null);
  const [dateTime, setDateTime] = useState(defaultDateTime);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/stock-opnames", { cache: "no-store" });
    if (response.ok) setOpnames((await response.json()).stockOpnames);
  };
  const select = (value: Opname) => { setSelected(value); setDateTime(value.transactionInput); setItems(value.items); setNotice(""); };
  const create = async () => {
    setBusy(true);
    try { const result = await mutate("/api/stock-opnames", "POST", { transactionAt: dateTime }); setNotice(`Stock Opname ${result.stockOpname.opnameNumber} dibuat.`); select(result.stockOpname); await refresh(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const recheck = async () => {
    if (!selected) return;
    setBusy(true);
    try { const result = await mutate(`/api/stock-opnames/${selected.id}/recheck`, "POST", { transactionAt: dateTime, items: items.map((item) => ({ sparePartId: item.sparePartId, physicalStock: item.physicalStock === "" ? null : item.physicalStock })) }); setSelected(result.stockOpname); setItems(result.stockOpname.items); setNotice("Recheck Stock Opname tersimpan."); await refresh(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const finalize = async () => {
    if (!selected || !window.confirm("Finalize Stock Opname? Stok belum berubah.")) return;
    setBusy(true);
    try { const result = await mutate(`/api/admin/stock-opnames/${selected.id}/finalize`, "POST", {}); setSelected(result.stockOpname); setItems(result.stockOpname.items); setNotice("Stock Opname berhasil di-Finalize."); await refresh(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!selected || !window.confirm("Approve Stock Opname? Adjustment akan diterapkan dan SO menjadi final.")) return;
    setBusy(true);
    try { const result = await mutate(`/api/admin/stock-opnames/${selected.id}/approve`, "POST", {}); setSelected(result.stockOpname); setItems(result.stockOpname.items); setNotice("Stock Opname berhasil di-Approve."); await refresh(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!selected || !window.confirm("Reject Stock Opname dan kembalikan ke Revision?")) return;
    setBusy(true);
    try { const result = await mutate(`/api/admin/stock-opnames/${selected.id}/reject`, "POST", { reason: rejectReason.trim() || null }); setSelected(result.stockOpname); setItems(result.stockOpname.items); setRejectReason(""); setNotice("Stock Opname dikembalikan ke Revision."); await refresh(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };

  return <main className="mx-auto max-w-7xl p-6">
    <a href="/beranda" className="text-sm text-blue-700">← Beranda</a>
    <h1 className="mt-3 text-2xl font-semibold">Stock Opname</h1>
    <p className="mt-2 text-sm text-slate-600">System stock creation tetap tersimpan sebagai histori. Adjustment hanya diterapkan saat Admin Approve.</p>
    {notice && <p role="status" className="my-3 rounded bg-slate-100 p-3">{notice}</p>}
    <section className="my-5 rounded border bg-white p-4"><div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Tanggal dan waktu<input className="rounded border px-3 py-2" type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} /></label><button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void create()}>Buat Stock Opname</button></div></section>
    <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
      <section className="space-y-2">{opnames.map((opname) => <button key={opname.id} className={`block w-full rounded border p-3 text-left ${selected?.id === opname.id ? "bg-slate-100" : "bg-white"}`} onClick={() => select(opname)}><strong>{opname.opnameNumber}</strong><span className="block text-sm text-slate-600">{opname.transactionDisplay} · {opname.status} · Rev {opname.revisionNumber}</span></button>)}{!opnames.length && <p className="rounded border bg-white p-3 text-sm text-slate-600">Belum ada Stock Opname.</p>}</section>
      {selected && <section className="rounded border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{selected.opnameNumber} · {selected.status}</h2><p className="text-sm text-slate-600">Revision {selected.revisionNumber}. Verified stock adalah basis adjustment saat approval.</p></div><div className="flex flex-wrap gap-2">{selected.status !== "APPROVED" && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void recheck()}>Simpan Recheck</button>}{role === "ADMIN" && selected.status === "REVISION" && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void finalize()}>Finalize</button>}{role === "ADMIN" && selected.status === "FINALIZED" && <><button disabled={busy} className="rounded bg-green-700 px-3 py-2 text-white" onClick={() => void approve()}>Approve</button><button disabled={busy} className="rounded bg-red-700 px-3 py-2 text-white" onClick={() => void reject()}>Reject</button></>}</div></div>{role === "ADMIN" && selected.status === "FINALIZED" && <label className="mt-4 grid gap-1 text-sm">Reason Reject (optional)<textarea className="rounded border p-2" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={1000} /> </label>}<div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Sparepart</th><th className="p-2">System Before</th><th className="p-2">Verified System</th><th className="p-2">Physical</th><th className="p-2">Difference</th>{role === "ADMIN" && <th className="p-2">Version</th>}</tr></thead><tbody>{items.map((item) => { const stale = role === "ADMIN" && item.verifiedStockVersion !== undefined && item.currentStockVersion !== item.verifiedStockVersion; return <tr key={item.sparePartId} className="border-b"><td className="p-2">{item.code} · {item.name}</td><td className="p-2">{item.systemStock}</td><td className="p-2">{item.verifiedSystemStock ?? item.systemStock}</td><td className="p-2">{selected.status === "APPROVED" ? item.physicalStock : <input className="w-24 rounded border px-2 py-1" inputMode="numeric" min="0" type="number" value={item.physicalStock ?? ""} onChange={(event) => setItems((current) => current.map((value) => value.sparePartId === item.sparePartId ? { ...value, physicalStock: event.target.value } : value))} />}</td><td className="p-2">{item.difference ?? "-"}</td>{role === "ADMIN" && <td className="p-2">{stale ? <span className="font-semibold text-red-700">Recount required</span> : `${item.verifiedStockVersion ?? "-"}`}</td>}</tr>; })}</tbody></table></div></section>}
    </div>
  </main>;
}
