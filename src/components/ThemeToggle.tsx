"use client";

import type { MouseEvent } from "react";
import { setTheme, useTheme, type ThemePref } from "@/lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";
import { cx } from "./ui";

const center = (e: MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Header switch between light and dark. The icons turn and swap as it flips. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={(e) => setTheme(dark ? "light" : "dark", center(e))}
      className={cx(
        "relative inline-flex size-10 items-center justify-center overflow-hidden rounded-full text-ink-soft transition-[color,box-shadow] duration-200 hover:text-action hover:shadow-[var(--neu-sm)] active:shadow-[var(--neu-in)]",
        className,
      )}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className={cx("absolute transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]", dark ? "-rotate-90 scale-50 opacity-0" : "rotate-0 opacity-100")}>
        <MoonIcon size={19} />
      </span>
      <span className={cx("absolute transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]", dark ? "rotate-0 opacity-100" : "rotate-90 scale-50 opacity-0")}>
        <SunIcon size={19} />
      </span>
      <span className="sr-only">{dark ? "Switch to light mode" : "Switch to dark mode"}</span>
    </button>
  );
}

const CHOICES: Array<{ id: ThemePref; label: string; icon: typeof SunIcon }> = [
  { id: "system", label: "Match my device", icon: MonitorIcon },
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
];

/** Three-way choice for the settings page, including following the device. */
export function ThemeChoice() {
  const { pref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex flex-wrap gap-1 neu-in rounded-2xl p-1">
      {CHOICES.map((c) => {
        const on = pref === c.id;
        const I = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => setTheme(c.id, center(e))}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200",
              on ? "neu-on" : "text-ink-soft hover:text-ink",
            )}
          >
            <I size={16} /> {c.label}
          </button>
        );
      })}
    </div>
  );
}
