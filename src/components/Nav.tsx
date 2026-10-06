"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOOLS } from "@/lib/tools";
import { cx } from "./ui";

const LINKS = [{ href: "/report", name: "Full report" }, ...TOOLS.map((t) => ({ href: t.href, name: t.name }))];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Tools" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1 py-1">
        {LINKS.map((l) => {
          const active = path === l.href;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded px-3 py-1.5 text-[0.95rem] whitespace-nowrap",
                  active ? "bg-page font-semibold text-ink shadow-sm" : "text-ink-soft hover:bg-page/60 hover:text-ink",
                )}
              >
                {l.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
