"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type ThemePref = "system" | "light" | "dark";

const KEY = "veritome-theme";

/** Runs before the page paints (inlined in <head>) so a chosen theme never flashes the other one first. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

const listeners = new Set<() => void>();

function read(): ThemePref {
  if (typeof document === "undefined") return "system";
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function write(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage can be blocked; the choice still applies to this visit.
  }
  listeners.forEach((l) => l());
}

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/**
 * Switches theme with a circle that spreads from `origin` (the button that was pressed) where the browser supports
 * view transitions; elsewhere colours cross-fade. No motion with reduced-motion settings.
 */
export function setTheme(pref: ThemePref, origin?: { x: number; y: number }) {
  if (reducedMotion()) return write(pref);
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || !origin) {
    const root = document.documentElement;
    root.classList.add("theme-fade");
    write(pref);
    window.setTimeout(() => root.classList.remove("theme-fade"), 400);
    return;
  }
  const { x, y } = origin;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => flushSync(() => write(pref)));
  t.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 550, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
}

/** The visitor's choice and the theme actually showing. */
export function useTheme(): { pref: ThemePref; resolved: "light" | "dark" } {
  const pref = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "system" as ThemePref,
  );
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return { pref, resolved: pref === "system" ? (dark ? "dark" : "light") : pref };
}
