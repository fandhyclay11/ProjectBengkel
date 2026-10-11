"use client";

import { LogoutButton } from "@/components/logout-button";

export function AppHeader({ title, username, role, onMenuToggle, menuOpen }: { title: string; username: string; role: "ADMIN" | "USER"; onMenuToggle: () => void; menuOpen: boolean }) {
  return <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[#D9D9D9] bg-white px-4 py-3 sm:px-6 print:hidden">
    <div className="flex min-w-0 items-center gap-3">
      <button type="button" onClick={onMenuToggle} aria-expanded={menuOpen} aria-controls="app-sidebar" className="rounded-lg border border-[#D9D9D9] p-2 text-[#171717] hover:border-[#D71920] hover:text-[#A80F16] focus:outline-none focus:ring-2 focus:ring-[#D71920] focus:ring-offset-2 lg:hidden" aria-label={menuOpen ? "Tutup navigasi" : "Buka navigasi"}>☰</button>
      <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-[#666666]">BIMANTARA MOTOR INDONESIA</p><h1 className="truncate text-xl font-bold text-[#171717] sm:text-2xl">{title}</h1></div>
    </div>
    <div className="flex shrink-0 items-center gap-3"><div className="hidden text-right sm:block"><p className="max-w-40 truncate text-sm font-semibold text-[#171717]">{username}</p><p className="text-xs text-[#666666]">{role}</p></div><LogoutButton /></div>
  </header>;
}
