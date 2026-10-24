import { cn } from "@/lib/utils";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import site from "./site.json";
import "./globals.css";

// Site metadata lives in site.json so Studio can update it without touching
// this file. The favicon and social image are separate files Next.js resolves
// by convention (icon.*, opengraph-image.*), so they need no code here.
export const metadata: Metadata = {
  // Absolute base for og:image; social crawlers reject relative URLs. Empty
  // until the project is published, which Next.js treats as "no base".
  ...(site.url ? { metadataBase: new URL(site.url) } : {}),
  title: site.title,
  description: site.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          GeistSans.variable,
          GeistMono.variable
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
