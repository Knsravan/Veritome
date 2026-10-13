"use client";

import { useSyncExternalStore } from "react";

/**
 * The glassmorphism preview: a whole-site look switched on by `data-ui="glass"` on <html> (styles in glass.css).
 * /preview/glass turns it on while it is open; "keep it on" remembers it in this browser only.
 */
const KEY = "veritome-ui";
const EVENT = "veritome-ui";

/** Runs before the page paints (inlined in <head>) so a kept preview never flashes the normal look first. */
export const UI_SCRIPT = `(function(){try{if(localStorage.getItem("${KEY}")==="glass")document.documentElement.dataset.ui="glass";}catch(e){}})();`;

/** Whether the glass look is kept on across the site in this browser. */
export function glassKept(): boolean {
  try {
    return localStorage.getItem(KEY) === "glass";
  } catch {
    return false;
  }
}

/** Shows or hides the glass look on this page, without remembering it. */
export function showGlass(on: boolean): void {
  if (on) document.documentElement.dataset.ui = "glass";
  else delete document.documentElement.dataset.ui;
  window.dispatchEvent(new Event(EVENT));
}

/** Keeps the glass look on across the site in this browser, or stops keeping it. */
export function keepGlass(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "glass");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the look still applies to this page.
  }
  showGlass(on);
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

/** Whether the glass look is showing and whether it is kept on. */
export function useGlass(): { showing: boolean; kept: boolean } {
  const showing = useSyncExternalStore(subscribe, () => document.documentElement.dataset.ui === "glass", () => false);
  const kept = useSyncExternalStore(subscribe, glassKept, () => false);
  return { showing, kept };
}
