import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/icons";
import type { ReactNode } from "react";
import { ConsentProvider } from "@/components/Consent";
import { SiteHeader } from "@/components/Nav";
import { SettingsProvider } from "@/lib/settings";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";
import "./controls.css";

export const metadata: Metadata = {
  title: {
    default: "Veritome: check your paper before you submit",
    template: "%s · Veritome",
  },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded bg-page px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <SettingsProvider>
          <ConsentProvider>
            <SiteHeader />
            <main
              id="main"
              className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
            >
              {children}
            </main>
            <footer className="border-t border-rule print:hidden">
              <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
                <div className="space-y-3">
                  <p className="flex items-center gap-2 font-display text-lg font-semibold">
                    <LogoMark size={22} /> Veritome
                  </p>
                  <p className="max-w-sm text-ink-soft">
                    Free, open-source checks for research writing. Your text is
                    processed in memory and never stored or logged on our servers.
                  </p>
                </div>
                <div>
                  <p className="font-semibold">Tools</p>
                  <ul className="mt-3 space-y-2 text-ink-soft">
                    <li>
                      <Link
                        href="/plagiarism"
                        className="hover:text-ink hover:underline"
                      >
                        Plagiarism
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/detector"
                        className="hover:text-ink hover:underline"
                      >
                        AI detector
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/humaniser"
                        className="hover:text-ink hover:underline"
                      >
                        Humaniser
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/paraphraser"
                        className="hover:text-ink hover:underline"
                      >
                        Paraphraser
                      </Link>
                    </li>
                    <li className="text-ink-faint">
                      Compare, Citations and Grammar: coming soon
                    </li>
                  </ul>
                </div>
                <div>
                  <p className="font-semibold">About</p>
                  <ul className="mt-3 space-y-2 text-ink-soft">
                    <li>
                      <Link
                        href="/about"
                        className="hover:text-ink hover:underline"
                      >
                        Limits and privacy
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/settings"
                        className="hover:text-ink hover:underline"
                      >
                        Settings
                      </Link>
                    </li>
                    <li>
                      <a
                        href="https://github.com/Knsravan/Veritome"
                        className="hover:text-ink hover:underline"
                      >
                        Source code (MIT)
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </footer>
          </ConsentProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
