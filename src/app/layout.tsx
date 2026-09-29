import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Bengkel",
  description: "Aplikasi operasional bengkel lokal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
