import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConsentProvider } from "@/components/Consent";
import { Nav } from "@/components/Nav";
import { SettingsProvider } from "@/lib/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Veritome: check your paper before you submit", template: "%s · Veritome" },
  description:
    "Open-source pre-publication checks for researchers: plagiarism, AI-writing patterns, citations and grammar, with the evidence and limits shown for every result.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e4e9ef" },
    { media: "(prefers-color-scheme: dark)", color: "#12171e" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only z-50 rounded bg-page px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
          Skip to content
        </a>
        <SettingsProvider>
          <ConsentProvider>
            <header className="border-b border-rule">
              <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 pt-4 pb-2 sm:px-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center justify-between gap-4">
                  <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">
                    Veritome
                  </Link>
                  <Link href="/settings" className="text-sm text-ink-soft underline-offset-4 hover:underline md:hidden">
                    Settings
                  </Link>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Nav />
                  <Link href="/settings" className="hidden text-sm text-ink-soft underline-offset-4 hover:underline md:block">
                    Settings
                  </Link>
                </div>
              </div>
            </header>
            <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
              {children}
            </main>
            <footer className="border-t border-rule">
              <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-ink-faint sm:flex-row sm:justify-between sm:px-6">
                <p>Your text is processed in memory and never stored or logged by Veritome.</p>
                <p className="flex gap-4">
                  <Link href="/about" className="underline-offset-4 hover:underline">
                    Limits and privacy
                  </Link>
                  <a href="https://github.com/Knsravan/Veritome" className="underline-offset-4 hover:underline">
                    Source code (MIT)
                  </a>
                </p>
              </div>
            </footer>
          </ConsentProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
