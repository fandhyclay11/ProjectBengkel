"use client";

import { useState } from "react";

type ReportName = "services" | "sls" | "purchases" | "expenses" | "stock" | "movements" | "stock-opnames" | "profit-loss";
type Row = Record<string, unknown>;
type ReportResult = { rows?: Row[]; total?: number; page?: number; pageSize?: number; summary?: Row };
type ReportData = { result?: ReportResult; generatedAt?: string };

const reports: Array<{ id: ReportName; label: string }> = [
  { id: "services", label: "Service" }, { id: "sls", label: "SLS" }, { id: "purchases", label: "Purchase" }, { id: "expenses", label: "Operational Expense" },
  { id: "stock", label: "Stock / Sparepart" }, { id: "movements", label: "Stock Movement" }, { id: "stock-opnames", label: "Stock Opname" }, { id: "profit-loss", label: "Profit & Loss" },
];

const money = new Intl.NumberFormat("id-ID");
function amount(value: unknown) { return value === null || value === undefined || value === "" ? "-" : `Rp ${money.format(Number(value))}`; }
function text(value: unknown) { return value === null || value === undefined || value === "" ? "-" : String(value); }
function dateTime(value: unknown, timezone: string) { return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(String(value))) : "-"; }
function label(key: string) { return key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()); }

function ServiceRow({ row, timezone }: { row: Row; timezone: string }) {
  const [open, setOpen] = useState(false);
  const jobs = Array.isArray(row.jobs) ? row.jobs as Row[] : [];
  const items = Array.isArray(row.items) ? row.items as Row[] : [];
  return <>
    <tr className="border-t align-top">
      <td className="px-3 py-3 font-medium">{text(row.serviceNumber)}</td>
      <td className="px-3 py-3">{dateTime(row.transactionAt, timezone)}<div className="text-xs text-slate-500">{text(row.vehicleDescription)}</div></td>
      <td className="px-3 py-3 text-right">{amount(row.subtotal)}</td>
      <td className="px-3 py-3 text-right">{amount(row.discount)}</td>
      <td className="px-3 py-3 text-right font-semibold">{amount(row.totalAmount)}</td>
      <td className="px-3 py-3 text-right">{amount(row.totalHpp)}</td>
      <td className="px-3 py-3 text-center"><button className="rounded border px-2 py-1 text-sm text-blue-700" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Tutup" : "Detail"}</button></td>
    </tr>
    {open && <tr className="border-t bg-slate-50"><td colSpan={7} className="p-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <div><h4 className="mb-2 font-semibold">Jobs ({jobs.length})</h4>{jobs.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Description</th><th className="pb-2 text-right">Amount</th></tr></thead><tbody>{jobs.map((job, index) => <tr key={index} className="border-b last:border-0"><td className="py-2">{text(job.description)}</td><td className="py-2 text-right">{amount(job.amount)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">Tidak ada job.</p>}</div>
        <div><h4 className="mb-2 font-semibold">Spareparts ({items.length})</h4>{items.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Part</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Selling price</th><th className="pb-2 text-right">Line amount</th><th className="pb-2 text-right">HPP</th></tr></thead><tbody>{items.map((item, index) => <tr key={index} className="border-b last:border-0"><td className="py-2">{text(item.partCodeSnapshot)}<div className="text-xs text-slate-500">{text(item.partNameSnapshot)}</div></td><td className="py-2 text-right">{text(item.quantity)}</td><td className="py-2 text-right">{amount(item.sellingPrice)}</td><td className="py-2 text-right">{amount(item.lineAmount)}</td><td className="py-2 text-right">{amount(item.lineHpp)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">Tidak ada sparepart.</p>}</div>
      </div>
    </td></tr>}
  </>;
}

function GenericTable({ rows }: { rows: Row[] }) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !["jobs", "items"].includes(key))))];
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left">{keys.map((key) => <th key={key} className="px-3 py-2 font-semibold">{label(key)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t">{keys.map((key) => <td key={key} className="whitespace-nowrap px-3 py-2">{text(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

export function ReportsClient({ defaultFrom, defaultTo, initialReport, workshopName, timezone }: { defaultFrom: string; defaultTo: string; initialReport?: string; workshopName: string; timezone: string }) {
  const [report, setReport] = useState<ReportName>(reports.some((item) => item.id === initialReport) ? initialReport as ReportName : "services");
  const [from, setFrom] = useState(defaultFrom); const [to, setTo] = useState(defaultTo); const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportData | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = async (nextPage = page) => { setBusy(true); setError(""); try { const response = await fetch(`/api/admin/reports/${report}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${nextPage}&pageSize=25`, { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Laporan gagal dimuat."); setPage(nextPage); setData(result); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  const exportReport = async (format: "pdf" | "xlsx") => { const csrf = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("pb_csrf="))?.slice(8) ?? ""; const response = await fetch(`/api/admin/reports/${report}/export/${format}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "POST", headers: { "x-csrf-token": csrf } }); if (!response.ok) { const result = await response.json().catch(() => ({})); setError(result.error ?? "Export gagal."); return; } const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${report}-${from}-${to}.${format}`; link.click(); URL.revokeObjectURL(url); };
  const result = data?.result; const rows = result?.rows ?? []; const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 25)));
  return <main className="mx-auto max-w-7xl p-6 print:max-w-none print:p-2"><a href="/beranda" className="text-sm text-blue-700 print:hidden">← Beranda</a><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Reports</h1><p className="text-sm text-slate-600">{workshopName} · Timezone: {timezone}</p></div><div className="flex flex-wrap gap-2 print:hidden"><button disabled={!data || busy} onClick={() => window.print()} className="rounded border px-3 py-2">Print</button><button disabled={!data || busy} onClick={() => void exportReport("pdf")} className="rounded border px-3 py-2">PDF</button><button disabled={!data || busy} onClick={() => void exportReport("xlsx")} className="rounded border px-3 py-2">Excel</button></div></div><section className="my-5 flex flex-wrap items-end gap-3 rounded border bg-white p-4 print:hidden"><label className="grid gap-1 text-sm">Report<select className="rounded border px-3 py-2" value={report} onChange={(event) => { setReport(event.target.value as ReportName); setData(null); setPage(1); }}>{reports.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="grid gap-1 text-sm">Dari<input className="rounded border px-3 py-2" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="grid gap-1 text-sm">Sampai<input className="rounded border px-3 py-2" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button disabled={busy} onClick={() => void load(1)} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Memuat..." : "Tampilkan"}</button></section>{error && <p role="alert" className="my-3 rounded bg-red-50 p-3 text-red-700">{error}</p>}<section className="report-paper rounded border bg-white p-4"><header className="mb-4 border-b pb-3"><h2 className="text-xl font-semibold">{reports.find((item) => item.id === report)?.label} Report</h2><p className="text-sm text-slate-600">Periode {from} s/d {to} · Generated: {data?.generatedAt ? dateTime(data.generatedAt, timezone) : "-"}</p></header>{report === "profit-loss" && result?.summary ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(result.summary).map(([key, value]) => <div key={key} className="rounded border p-3"><div className="text-xs text-slate-500">{label(key)}</div><div className="mt-1 font-semibold">{typeof value === "string" && /^-?\d+$/.test(value) ? amount(value) : text(value)}</div></div>)}</div> : report === "services" ? <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead><tr className="border-b text-left"><th className="px-3 py-2">Service transaction</th><th className="px-3 py-2">Date / vehicle</th><th className="px-3 py-2 text-right">Subtotal</th><th className="px-3 py-2 text-right">Discount</th><th className="px-3 py-2 text-right">Transaction total</th><th className="px-3 py-2 text-right">HPP (Admin)</th><th className="px-3 py-2 text-center">Details</th></tr></thead><tbody>{rows.map((row, index) => <ServiceRow key={index} row={row} timezone={timezone} />)}</tbody></table></div> : <GenericTable rows={rows} />}{data && report !== "profit-loss" && <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm print:hidden"><span>Page {result?.page ?? page} of {totalPages} · {result?.total ?? 0} transaction</span><div className="flex gap-2"><button disabled={busy || page <= 1} onClick={() => void load(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Sebelumnya</button><button disabled={busy || page >= totalPages} onClick={() => void load(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Berikutnya</button></div></div>}</section></main>;
}
