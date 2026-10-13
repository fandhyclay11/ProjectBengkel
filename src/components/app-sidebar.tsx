"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Ref } from "react";

type Role = "ADMIN" | "USER";
type MenuItem = { href: string; label: string };
type MenuGroup = { label: string; items: MenuItem[] };

const adminGroups: MenuGroup[] = [
  { label: "Operasional", items: [{ href: "/dashboard", label: "Dashboard" }, { href: "/services", label: "Service" }, { href: "/sls", label: "Sales" }, { href: "/expenses", label: "Expense" }] },
  { label: "Persediaan", items: [{ href: "/spareparts", label: "Daftar Sparepart" }, { href: "/purchases", label: "Purchase" }, { href: "/stock-card", label: "Stok Movement" }, { href: "/stock-opname", label: "Stock Opname" }] },
  { label: "Keuangan", items: [{ href: "/reports", label: "Reports" }] },
  { label: "Pengaturan", items: [{ href: "/admin/users", label: "Manajemen User" }] },
];

const userGroups: MenuGroup[] = [
  { label: "Operasional", items: [{ href: "/services", label: "Service" }, { href: "/sls", label: "Sales" }, { href: "/purchases", label: "Purchase" }] },
  { label: "Persediaan", items: [{ href: "/spareparts", label: "Daftar Sparepart" }, { href: "/stock-opname", label: "Stock Opname" }] },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href === "/admin/users" && pathname.startsWith(`${href}/`));
}

export function AppSidebar({ role, open, mobile, onClose, ref }: { role: Role; open: boolean; mobile: boolean; onClose: () => void; ref: Ref<HTMLElement> }) {
  const pathname = usePathname();
  const groups = role === "ADMIN" ? adminGroups : userGroups;
  return <>
     <aside ref={ref} id="app-sidebar" className={`fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col bg-[var(--color-sidebar)] text-[var(--color-surface)] transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 print:hidden ${open ? "translate-x-0" : "-translate-x-full"}`} role={open && mobile ? "dialog" : undefined} aria-modal={open && mobile ? true : undefined} aria-labelledby="app-sidebar-title" aria-label="Navigasi utama">
      <div className="flex shrink-0 items-center justify-between gap-2 border-r border-[rgba(23,63,58,0.22)] bg-[#f0eee8] p-3 text-[var(--color-ink)] sm:p-4">
        <a href="/beranda" onClick={onClose} className="relative z-10 flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2">
          <Image className="h-16 w-24 shrink-0 object-contain" src="/brand/bimantara-motor-indonesia.jpg" alt="BIMANTARA MOTOR INDONESIA" width={160} height={112} priority />
          <span id="app-sidebar-title" className="font-[var(--font-plus-jakarta-sans)] text-[0.78rem] font-extrabold uppercase leading-[1.2] tracking-[0.045em] text-[var(--color-sidebar)]">BIMANTARA MOTOR INDONESIA</span>
        </a>
        <button type="button" onClick={onClose} className="relative z-10 rounded-lg p-2 text-xl text-[var(--color-ink)] hover:bg-[var(--color-active)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] lg:hidden" aria-label="Tutup navigasi">×</button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--color-sidebar)] px-3 py-2 sm:px-4" aria-label="Menu aplikasi">
        <a href="/beranda" onClick={onClose} className={`mb-3 flex min-h-10 items-center rounded-lg border-l-4 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:ring-offset-2 focus:ring-offset-[var(--color-sidebar)] ${pathname === "/beranda" ? "border-[var(--color-brand)] bg-[var(--color-active)] text-[var(--color-sidebar)]" : "border-transparent text-[var(--color-surface)] hover:bg-[var(--color-sidebar-hover)]"}`}>Beranda</a>
        {groups.map((group) => <section key={group.label} className="mb-3"><h2 className="mb-1.5 border-t border-[var(--color-sidebar-divider)] px-3 pb-1 pt-2.5 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[var(--color-sage)]">{group.label}</h2><div className="space-y-0.5">{group.items.map((item) => <a key={item.href} href={item.href} onClick={onClose} aria-current={isActive(pathname, item.href) ? "page" : undefined} className={`flex min-h-9 items-center rounded-md border-l-4 px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:ring-offset-2 focus:ring-offset-[var(--color-sidebar)] ${isActive(pathname, item.href) ? "border-[var(--color-brand)] bg-[var(--color-active)] font-semibold text-[var(--color-sidebar)]" : "border-transparent text-[var(--color-surface)] hover:bg-[var(--color-sidebar-hover)]"}`}>{item.label}</a>)}</div></section>)}
      </nav>
    </aside>
    {open && <button type="button" className="fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden" onClick={onClose} aria-label="Tutup navigasi" />}
  </>;
}
