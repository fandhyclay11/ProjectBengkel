"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ role, username, title, children }: { role: "ADMIN" | "USER"; username: string; title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);
  return <div className="min-h-screen bg-[#F5F5F5] text-[#171717] lg:flex">
    <AppSidebar role={role} open={menuOpen} onClose={() => setMenuOpen(false)} />
    <div className="min-w-0 flex-1"><AppHeader title={title} username={username} role={role} menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((open) => !open)} /><main className="min-w-0 p-4 sm:p-6 print:p-0">{children}</main></div>
  </div>;
}
