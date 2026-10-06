"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicStatus } from "@/server/config";

export interface Settings {
  /** Remembered answer to the external-search consent question. null means "ask every time". */
  externalConsent: boolean | null;
  /** Include paid web search (Brave or Serper) when the server has it. */
  webSearch: boolean;
  /** Browser-supplied language model, only used when the server allows it. */
  llm: { baseUrl: string; model: string; apiKey: string };
}

const DEFAULTS: Settings = { externalConsent: null, webSearch: true, llm: { baseUrl: "", model: "", apiKey: "" } };
const KEY = "veritome.settings.v1";

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed, llm: { ...DEFAULTS.llm, ...parsed.llm } };
  } catch {
    return DEFAULTS;
  }
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  status: PublicStatus | null;
  /** Fields to add to a request so the server can use the browser's language model, if allowed. */
  llmFields: () => { llm?: { baseUrl: string; model: string; apiKey?: string } };
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [status, setStatus] = useState<PublicStatus | null>(null);

  useEffect(() => {
    setSettings(load());
    fetch("/api/status")
      .then((r) => (r.ok ? (r.json() as Promise<PublicStatus>) : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode or blocked storage: settings last for this visit only.
      }
      return next;
    });
  }, []);

  const llmFields = useCallback(() => {
    const { baseUrl, model, apiKey } = settings.llm;
    if (!status?.allowClientLlm || !baseUrl || !model) return {};
    return { llm: { baseUrl, model, ...(apiKey ? { apiKey } : {}) } };
  }, [settings.llm, status]);

  const value = useMemo(() => ({ settings, update, status, llmFields }), [settings, update, status, llmFields]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

/** True when a language model is available to this browser, from the server or the user's own settings. */
export function useHasLlm(): boolean {
  const { status, settings } = useSettings();
  return Boolean(status?.llm || (status?.allowClientLlm && settings.llm.baseUrl && settings.llm.model));
}
