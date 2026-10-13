import type { DashboardResult } from "@/server/dashboard-query-service";

const money = (value: string) => `Rp ${BigInt(value).toLocaleString("id-ID")}`;

function Shortcut({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return <a href={href} className={`group flex min-h-16 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[var(--color-page)] ${primary ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white shadow-sm hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-hover)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-sidebar)] hover:bg-[var(--color-active)]"}`}>
    <span>{label}</span><span aria-hidden="true" className="text-base opacity-70 transition-transform group-hover:translate-x-0.5">›</span>
  </a>;
}

function MetricCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = <><p className="text-sm font-medium text-[var(--color-muted)]">{label}</p><p className="mt-3 font-[var(--font-plus-jakarta-sans)] text-2xl font-bold tracking-tight text-[var(--color-ink)]">{value}</p></>;
  const className = "block rounded-2xl border-t-4 border-[var(--color-border)] border-t-[var(--color-sage)] bg-[var(--color-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[var(--color-page)]";
  return href ? <a href={href} className={className}>{content}</a> : <article className={className}>{content}</article>;
}

function WelcomePanel({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="relative isolate overflow-hidden rounded-3xl bg-[var(--color-sidebar)] p-6 text-[var(--color-surface)] shadow-md sm:p-8 lg:p-9">
    <div aria-hidden="true" className="absolute -right-10 -top-20 -z-10 h-64 w-64 rounded-full border-[28px] border-[var(--color-sidebar-hover)] opacity-70" />
    <div aria-hidden="true" className="absolute -bottom-24 right-28 -z-10 h-44 w-44 rounded-full bg-[var(--color-sage)] opacity-15" />
    <div className="relative flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-sage)]">BIMANTARA MOTOR INDONESIA</p>
        <h2 className="font-[var(--font-plus-jakarta-sans)] text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-surface)]/85 sm:text-base">{description}</p>
      </div>
      {action}
    </div>
  </div>;
}

function QuickActions({ children }: { children: React.ReactNode }) {
  return <section aria-labelledby="quick-actions-title" className="mt-8">
    <div className="mb-4 flex items-end justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-muted)]">Mulai dari sini</p><h2 id="quick-actions-title" className="mt-1 font-[var(--font-plus-jakarta-sans)] text-xl font-bold text-[var(--color-ink)]">Akses cepat</h2></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{children}</div>
  </section>;
}

export function BerandaOperationalSummary({ role, dashboard, dashboardError }: { role: "ADMIN" | "USER"; dashboard?: DashboardResult; dashboardError?: boolean }) {
  if (role === "USER") return <div className="mx-auto max-w-6xl">
    <WelcomePanel title="Selamat datang" description="Gunakan pintasan untuk melanjutkan pekerjaan operasional." />
    <QuickActions>
      <Shortcut href="/services" label="Service" primary />
      <Shortcut href="/sls" label="Sales" primary />
      <Shortcut href="/purchases" label="Purchase" />
      <Shortcut href="/spareparts" label="Daftar Sparepart" />
      <Shortcut href="/stock-opname" label="Stock Opname" />
    </QuickActions>
  </div>;

  if (dashboardError || !dashboard) return <section className="mx-auto max-w-5xl rounded-3xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-error)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-8">
    <h2 className="font-[var(--font-plus-jakarta-sans)] text-2xl font-bold text-[var(--color-ink)]">Ringkasan operasional</h2>
    <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">Ringkasan Dashboard tidak dapat dimuat. Buka Dashboard untuk mencoba kembali.</p>
    <a href="/dashboard" className="mt-5 inline-flex rounded-xl bg-[var(--color-brand)] px-4 py-2.5 font-semibold text-white transition hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2">Buka Dashboard</a>
  </section>;

  const { kpis } = dashboard;
  return <div className="mx-auto max-w-6xl">
    <WelcomePanel
      title="Ringkasan operasional"
      description="Periode bulan berjalan · Data mengikuti definisi Dashboard."
      action={<a href="/dashboard" className="inline-flex min-h-11 items-center gap-3 rounded-xl bg-[var(--color-surface)] px-4 py-2.5 text-sm font-bold text-[var(--color-sidebar)] shadow-sm transition hover:bg-[var(--color-active)] focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:ring-offset-2 focus:ring-offset-[var(--color-sidebar)]">Dashboard lengkap <span aria-hidden="true">→</span></a>}
    />
    <section aria-label="Metrik operasional" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard label="Service Revenue" value={money(kpis.serviceRevenue)} href="/reports?report=services" />
      <MetricCard label="Sales Revenue" value={money(kpis.slsRevenue)} href="/reports?report=sls" />
      <MetricCard label="Stok Menipis" value={String(kpis.lowStockCount)} href="/spareparts?filter=low" />
      <MetricCard label="Purchase Draft Pending" value={String(kpis.pendingPurchaseDraftCount)} href="/purchases" />
      <MetricCard label="Service Count" value={String(kpis.serviceCount)} href="/reports?report=services" />
      <MetricCard label="Sales Count" value={String(kpis.slsCount)} href="/reports?report=sls" />
    </section>
    <QuickActions>
      <Shortcut href="/services" label="Buat Service" primary />
      <Shortcut href="/sls" label="Buat Sales" primary />
      <Shortcut href="/purchases" label="Purchase" />
      <Shortcut href="/spareparts" label="Daftar Sparepart" />
      <Shortcut href="/stock-opname" label="Stock Opname" />
    </QuickActions>
  </div>;
}
