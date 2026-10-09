"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { TOOLS } from "@/lib/tools";
import { ThemeToggle } from "./ThemeToggle";
import { HistoryIcon, LogoMark, MenuIcon, SettingsIcon, XIcon } from "./icons";
import { cx } from "./ui";

const LINKS: Array<{ href: string; name: string; soon?: boolean }> = TOOLS.map(
  (t) => ({ href: t.href, name: t.name, ...(t.soon ? { soon: true } : {}) }),
);

/** Site header: brand, tool links, settings and the main call to action. Tightens on scroll; a menu on small screens. */
export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuId = useId();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cx(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 print:hidden",
        scrolled || open
          ? "border-[var(--neu-edge)] bg-desk/85 shadow-[0_8px_18px_-8px_var(--neu-dark)] backdrop-blur-xl supports-[backdrop-filter]:bg-desk/75"
          : "border-transparent bg-transparent",
      )}
    >
      <div
        className={cx(
          "mx-auto flex max-w-7xl items-center gap-6 px-4 transition-[height] duration-300 sm:px-6",
          scrolled ? "h-14" : "h-[4.5rem]",
        )}
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-lg"
          aria-label="Veritome home"
        >
          <span className="transition-transform duration-300 group-hover:-rotate-6">
            <LogoMark size={30} mode="intro" />
          </span>
          <span className="font-display text-[1.25rem] font-bold tracking-tight">
            Veritome
          </span>
        </Link>

        <nav
          aria-label="Tools"
          className="hidden flex-1 justify-center lg:flex"
        >
          <ul className="neu-in flex items-center gap-1 rounded-full p-1">
            {LINKS.map((l) => {
              const active = path === l.href;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    title={l.soon ? `${l.name}: coming soon` : undefined}
                    className={cx(
                      "block rounded-full px-3 py-1.5 xl:px-3.5 text-[0.9rem] font-medium whitespace-nowrap transition-[background-color,color,transform] duration-300 active:scale-95",
                      active
                        ? "neu-on"
                        : l.soon
                          ? "text-ink-faint hover:bg-desk-deep hover:text-ink-soft"
                          : "text-ink-soft hover:bg-desk-deep hover:text-ink",
                    )}
                  >
                    {l.name}
                    {l.soon && (
                      <>
                        <span className="ml-1.5 hidden rounded-full bg-desk-deep px-1.5 py-px align-middle text-[0.65rem] font-semibold tracking-wide text-ink-faint uppercase 2xl:inline">
                          Soon
                        </span>
                        <span className="sr-only 2xl:hidden"> (coming soon)</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/history"
            aria-current={path === "/history" ? "page" : undefined}
            className="nb nb-round hidden sm:inline-flex"
            title="History"
          >
            <HistoryIcon />
            <span className="sr-only">History</span>
          </Link>
          <Link
            href="/settings"
            aria-current={path === "/settings" ? "page" : undefined}
            className="nb nb-round hidden sm:inline-flex"
            title="Settings"
          >
            <SettingsIcon />
            <span className="sr-only">Settings</span>
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="nb nb-round text-ink lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <XIcon size={20} /> : <MenuIcon size={20} />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      <nav
        id={menuId}
        aria-label="Menu"
        hidden={!open}
        className="animate-fade-in border-t border-[var(--neu-edge)] bg-desk lg:hidden"
      >
        <ul className="mx-auto grid max-w-7xl gap-1 px-4 py-3 sm:grid-cols-2 sm:px-6">
          {[
            ...LINKS,
            { href: "/history", name: "History" },
            { href: "/settings", name: "Settings" },
            { href: "/about", name: "Limits and privacy" },
          ].map((l, i) => (
            <li
              key={l.href}
              className="animate-fade-up"
              style={{ ["--i" as string]: i }}
            >
              <Link
                href={l.href}
                aria-current={path === l.href ? "page" : undefined}
                className={cx(
                  "block rounded-xl px-3 py-2.5 font-medium transition-shadow duration-200",
                  path === l.href
                    ? "neu-on"
                    : "hover:shadow-[var(--neu-sm)]",
                  l.soon && "text-ink-faint",
                )}
              >
                {l.name}
                {l.soon && (
                  <span className="ml-2 rounded-full bg-desk-deep px-1.5 py-px text-[0.65rem] font-semibold tracking-wide uppercase">
                    Soon
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
