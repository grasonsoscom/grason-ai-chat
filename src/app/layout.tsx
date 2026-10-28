import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrasOn AI Chat",
  description: "CRM untuk bisnis yang berjualan lewat WhatsApp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
