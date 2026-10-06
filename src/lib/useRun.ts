"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Runs one request at a time, cancels the previous one and keeps the last result or error. */
export function useRun<T>() {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (fn: (signal: AbortSignal) => Promise<T>) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setError(null);
    try {
      const r = await fn(c.signal);
      if (!c.signal.aborted) setResult(r);
      return r;
    } catch (err) {
      if (c.signal.aborted) return null;
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      if (ctrl.current === c) setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setBusy(false);
  }, []);

  return { result, setResult, error, setError, busy, run, cancel };
}
