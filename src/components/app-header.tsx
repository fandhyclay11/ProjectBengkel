"use client";

import { LogoutButton } from "@/components/logout-button";
import type { RefObject } from "react";

export function AppHeader({ title, username, role, onMenuToggle, menuOpen, menuButtonRef }: { title: string; username: string; role: "ADMIN" | "USER"; onMenuToggle: () => void; menuOpen: boolean; menuButtonRef: RefObject<HTMLButtonElement | null> }) {
  return <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-6 print:hidden">
    <div className="flex min-w-0 items-center gap-3">
       <button ref={menuButtonRef} type="button" onClick={onMenuToggle} aria-expanded={menuOpen} aria-controls="app-sidebar" className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 lg:hidden" aria-label={menuOpen ? "Tutup navigasi" : "Buka navigasi"}>☰</button>
      <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">BIMANTARA MOTOR INDONESIA</p><h1 className="truncate text-xl font-bold text-[var(--color-ink)] sm:text-2xl">{title}</h1></div>
    </div>
    <div className="flex shrink-0 items-center gap-3"><div className="hidden text-right sm:block"><p className="max-w-40 truncate text-sm font-semibold text-[var(--color-ink)]">{username}</p><p className="text-xs text-[var(--color-muted)]">{role}</p></div><LogoutButton /></div>
  </header>;
}
