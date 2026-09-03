import type { Metadata } from "next";
import "./globals.css";
import { THEME_SCRIPT, ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "TraceBox",
  description: "See the moments before a machine went down, from another device.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /*
     * data-theme sunucuda "light" yazılıyor, tarayıcıda aşağıdaki script onu
     * kullanıcının tercihiyle değiştirebiliyor. React bu farkı bir uyumsuzluk
     * sanır; suppressHydrationWarning tam olarak bunun için var — fark
     * kasıtlı ve yalnızca bu öznitelikte.
     */
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
