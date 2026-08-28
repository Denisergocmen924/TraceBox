import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceBox",
  description: "Makine çökmeden önceki anı başka bir cihazdan görebilmek.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
