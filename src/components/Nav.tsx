"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { TOOLS } from "@/lib/tools";
import { LogoMark, MenuIcon, SettingsIcon, XIcon } from "./icons";
import { cx } from "./ui";

const LINKS = TOOLS.map((t) => ({ href: t.href, name: t.name }));

/** Site header: brand, tool links, settings and the main call to action. Collapses into a menu on small screens. */
export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-desk/95 backdrop-blur supports-[backdrop-filter]:bg-desk/85 print:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded" aria-label="Veritome home">
          <LogoMark />
          <span className="font-serif text-[1.35rem] font-semibold tracking-tight">Veritome</span>
        </Link>

        <nav aria-label="Tools" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-0.5">
            {LINKS.map((l) => {
              const active = path === l.href;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "block rounded-md px-3 py-2 text-[0.94rem] whitespace-nowrap transition-colors",
                      active ? "bg-page font-semibold text-ink shadow-[0_0_0_1px_var(--rule)]" : "text-ink-soft hover:bg-page/70 hover:text-ink",
                    )}
                  >
                    {l.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/settings"
            aria-current={path === "/settings" ? "page" : undefined}
            className="hidden size-10 items-center justify-center rounded-md text-ink-soft hover:bg-page/70 hover:text-ink sm:inline-flex"
            title="Settings"
          >
            <SettingsIcon />
            <span className="sr-only">Settings</span>
          </Link>
          <Link
            href="/report"
            aria-current={path === "/report" ? "page" : undefined}
            className="inline-flex h-10 items-center rounded-md bg-action px-4 text-[0.94rem] font-semibold whitespace-nowrap text-action-ink shadow-sm transition-opacity hover:opacity-90"
          >
            Check a paper
          </Link>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-page/70 lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <XIcon size={20} /> : <MenuIcon size={20} />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      <nav id={menuId} aria-label="Menu" hidden={!open} className="border-t border-rule bg-page lg:hidden">
        <ul className="mx-auto grid max-w-7xl gap-1 px-4 py-3 sm:grid-cols-2 sm:px-6">
          {[...LINKS, { href: "/settings", name: "Settings" }, { href: "/about", name: "Limits and privacy" }].map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={path === l.href ? "page" : undefined}
                className={cx("block rounded-md px-3 py-2.5", path === l.href ? "bg-action-soft font-semibold" : "hover:bg-desk")}
              >
                {l.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
