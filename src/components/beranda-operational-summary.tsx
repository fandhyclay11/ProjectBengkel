import type { DashboardResult } from "@/server/dashboard-query-service";

const money = (value: string) => `Rp ${BigInt(value).toLocaleString("id-ID")}`;

function Shortcut({ href, label }: { href: string; label: string }) {
  return <a href={href} className="rounded-xl border border-[#D9D9D9] bg-white px-4 py-3 text-sm font-semibold text-[#171717] transition hover:border-[#D71920] hover:text-[#A80F16] focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2">{label}</a>;
}

function MetricCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = <><p className="text-sm text-[#666666]">{label}</p><p className="mt-2 text-xl font-bold text-[#171717]">{value}</p></>;
  return href ? <a href={href} className="rounded-2xl border border-[#D9D9D9] bg-white p-5 shadow-sm transition hover:border-[#D71920] focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2">{content}</a> : <article className="rounded-2xl border border-[#D9D9D9] bg-white p-5 shadow-sm">{content}</article>;
}

export function BerandaOperationalSummary({ role, dashboard, dashboardError }: { role: "ADMIN" | "USER"; dashboard?: DashboardResult; dashboardError?: boolean }) {
  if (role === "USER") return <section className="mx-auto max-w-4xl"><div className="rounded-2xl border border-[#D9D9D9] bg-white p-6 shadow-sm sm:p-8"><h2 className="text-2xl font-bold text-[#171717]">Selamat datang</h2><p className="mt-2 text-[#666666]">Gunakan pintasan untuk melanjutkan pekerjaan operasional.</p><div className="mt-6 flex flex-wrap gap-3"><Shortcut href="/services" label="Service" /><Shortcut href="/sls" label="Sales" /><Shortcut href="/purchases" label="Purchase" /><Shortcut href="/spareparts" label="Daftar Sparepart" /><Shortcut href="/stock-opname" label="Stock Opname" /></div></div></section>;

  if (dashboardError || !dashboard) return <section className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-2xl font-bold text-[#171717]">Ringkasan operasional</h2><p role="alert" className="mt-3 text-sm text-red-700">Ringkasan Dashboard tidak dapat dimuat. Buka Dashboard untuk mencoba kembali.</p><a href="/dashboard" className="mt-5 inline-flex rounded-lg bg-[#D71920] px-4 py-2 font-semibold text-white transition hover:bg-[#A80F16] focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2">Buka Dashboard</a></section>;

  const { kpis } = dashboard;
  return <section className="mx-auto max-w-5xl"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold text-[#171717]">Ringkasan operasional</h2><p className="mt-1 text-sm text-[#666666]">Periode bulan berjalan · Data mengikuti definisi Dashboard.</p></div><a href="/dashboard" className="rounded-lg border border-[#D9D9D9] bg-white px-4 py-2 text-sm font-semibold text-[#171717] transition hover:border-[#D71920] hover:text-[#A80F16] focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2">Dashboard lengkap</a></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Service Revenue" value={money(kpis.serviceRevenue)} href="/reports?report=services" /><MetricCard label="Sales Revenue" value={money(kpis.slsRevenue)} href="/reports?report=sls" /><MetricCard label="Stok Menipis" value={String(kpis.lowStockCount)} href="/spareparts?filter=low" /><MetricCard label="Purchase Draft Pending" value={String(kpis.pendingPurchaseDraftCount)} href="/purchases" /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><MetricCard label="Service Count" value={String(kpis.serviceCount)} href="/reports?report=services" /><MetricCard label="Sales Count" value={String(kpis.slsCount)} href="/reports?report=sls" /></div><div className="mt-6 flex flex-wrap gap-3"><Shortcut href="/services" label="Buat Service" /><Shortcut href="/sls" label="Buat Sales" /><Shortcut href="/purchases" label="Purchase" /><Shortcut href="/spareparts" label="Daftar Sparepart" /><Shortcut href="/stock-opname" label="Stock Opname" /></div></section>;
}
