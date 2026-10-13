"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ role, username, title, children }: { role: "ADMIN" | "USER"; username: string; title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const content = document.getElementById("app-content");
    if (menuOpen && isMobile) {
      wasOpenRef.current = true;
      content?.setAttribute("inert", "");
      sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      content?.removeAttribute("inert");
      menuButtonRef.current?.focus();
    }
  }, [isMobile, menuOpen]);
  useEffect(() => {
    if (!menuOpen || !isMobile) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!sidebarRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [isMobile, menuOpen]);
  return <div className="min-h-screen bg-[var(--color-page)] text-[var(--color-ink)] lg:flex lg:h-screen lg:min-h-0 lg:overflow-hidden">
    <AppSidebar ref={sidebarRef} role={role} open={menuOpen} mobile={isMobile} onClose={() => setMenuOpen(false)} />
    <div id="app-content" className="min-w-0 flex-1 lg:h-screen lg:min-h-0 lg:overflow-y-auto"><AppHeader menuButtonRef={menuButtonRef} title={title} username={username} role={role} menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((open) => !open)} /><main className="min-w-0 p-4 sm:p-6 print:p-0">{children}</main></div>
  </div>;
}
