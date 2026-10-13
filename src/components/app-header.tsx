"use client";

import { LogoutButton } from "@/components/logout-button";
import type { RefObject } from "react";

export function AppHeader({ title, centerTitle = true, username, role, onMenuToggle, menuOpen, menuButtonRef }: { title: string; centerTitle?: boolean; username: string; role: "ADMIN" | "USER"; onMenuToggle: () => void; menuOpen: boolean; menuButtonRef: RefObject<HTMLButtonElement | null> }) {
  return <header className="sticky top-0 z-20 flex min-h-24 items-center justify-between gap-4 border-b border-[rgba(143,16,24,0.28)] bg-[#f0eee8] px-4 py-3 sm:px-6 print:hidden">
    <div className="relative z-10 flex min-w-0 items-center gap-3">
       <button ref={menuButtonRef} type="button" onClick={onMenuToggle} aria-expanded={menuOpen} aria-controls="app-sidebar" className="rounded-lg border border-[rgba(143,16,24,0.35)] p-2 text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:bg-[rgba(181,18,27,0.08)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[#fffdf8] lg:hidden" aria-label={menuOpen ? "Tutup navigasi" : "Buka navigasi"}>☰</button>
    </div>
    <div className={`min-w-0 ${centerTitle ? "absolute left-1/2 top-1/2 z-10 w-max max-w-[40%] -translate-x-1/2 -translate-y-1/2 text-center" : "relative z-10"}`}><p className="truncate text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">BIMANTARA MOTOR INDONESIA</p><h1 className="truncate text-xl font-bold uppercase text-[var(--color-ink)] sm:text-2xl">{title}</h1></div>
    <div className="relative z-10 flex shrink-0 items-center gap-3"><div className="hidden text-right sm:block"><p className="max-w-40 truncate text-sm font-semibold text-[var(--color-ink)]">{username}</p><p className="text-xs text-[var(--color-muted)]">{role}</p></div><LogoutButton onBrandBackground /></div>
  </header>;
}
