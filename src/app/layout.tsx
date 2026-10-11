import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIMANTARA MOTOR INDONESIA",
  description: "Aplikasi operasional bengkel BIMANTARA MOTOR INDONESIA.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
