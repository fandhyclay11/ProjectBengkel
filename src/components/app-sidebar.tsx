"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

type Role = "ADMIN" | "USER";
type MenuItem = { href: string; label: string };
type MenuGroup = { label: string; items: MenuItem[] };

const adminGroups: MenuGroup[] = [
  { label: "Operasional", items: [{ href: "/dashboard", label: "Dashboard" }, { href: "/services", label: "Service" }, { href: "/sls", label: "Sales" }] },
  { label: "Persediaan", items: [{ href: "/spareparts", label: "Daftar Sparepart" }, { href: "/purchases", label: "Purchase" }, { href: "/stock-card", label: "Stok Movement" }, { href: "/stock-opname", label: "Stock Opname" }] },
  { label: "Keuangan", items: [{ href: "/expenses", label: "Expense" }, { href: "/reports", label: "Reports" }] },
  { label: "Pengaturan", items: [{ href: "/admin/users", label: "Manajemen User" }] },
];

const userGroups: MenuGroup[] = [
  { label: "Operasional", items: [{ href: "/services", label: "Service" }, { href: "/sls", label: "Sales" }, { href: "/purchases", label: "Purchase" }] },
  { label: "Persediaan", items: [{ href: "/spareparts", label: "Daftar Sparepart" }, { href: "/stock-opname", label: "Stock Opname" }] },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href === "/admin/users" && pathname.startsWith(`${href}/`));
}

export function AppSidebar({ role, open, onClose }: { role: Role; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const groups = role === "ADMIN" ? adminGroups : userGroups;
  return <>
    <aside id="app-sidebar" className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[#D9D9D9] bg-white transition-transform duration-200 lg:static lg:translate-x-0 print:hidden ${open ? "translate-x-0" : "-translate-x-full"}`} aria-label="Navigasi utama">
      <div className="flex items-center justify-between border-b border-[#D9D9D9] p-4">
        <a href="/beranda" onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2">
          <Image className="h-14 w-20 shrink-0 object-contain" src="/brand/bimantara-motor-indonesia.jpg" alt="BIMANTARA MOTOR INDONESIA" width={160} height={112} priority />
          <span className="text-sm font-bold leading-tight text-[#171717]">BIMANTARA MOTOR INDONESIA</span>
        </a>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-xl text-[#171717] hover:bg-[#F5F5F5] focus:outline-none focus:ring-2 focus:ring-[#D71920] lg:hidden" aria-label="Tutup navigasi">×</button>
      </div>
      <nav className="flex-1 overflow-y-auto p-4" aria-label="Menu aplikasi">
        <a href="/beranda" onClick={onClose} className={`mb-5 flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2 ${pathname === "/beranda" ? "border-[#D71920] bg-red-50 text-[#A80F16]" : "border-transparent text-[#171717] hover:bg-[#F5F5F5]"}`}>Beranda</a>
        {groups.map((group) => <section key={group.label} className="mb-5"><h2 className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-[#666666]">{group.label}</h2><div className="space-y-1">{group.items.map((item) => <a key={item.href} href={item.href} onClick={onClose} aria-current={isActive(pathname, item.href) ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg border-l-4 px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2 ${isActive(pathname, item.href) ? "border-[#D71920] bg-red-50 text-[#A80F16]" : "border-transparent text-[#171717] hover:bg-[#F5F5F5] hover:text-[#A80F16]"}`}>{item.label}</a>)}</div></section>)}
      </nav>
    </aside>
    {open && <button type="button" className="fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden" onClick={onClose} aria-label="Tutup navigasi" />}
  </>;
}
