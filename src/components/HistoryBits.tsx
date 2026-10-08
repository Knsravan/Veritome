"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPaper, type LoadedPaper } from "@/components/FileDrop";
import {
  findCheck,
  getCheck,
  openHref,
  type HistoryEntry,
  type HistorySummary,
  type HistoryTool,
} from "@/lib/history";
import { HistoryIcon } from "./icons";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Points out that the same text was already checked with this tool, with a link to the saved result. */
export function SeenBefore({
  tool,
  text,
}: {
  tool: HistoryTool;
  text: string;
}) {
  const [hit, setHit] = useState<HistorySummary | null>(null);
  useEffect(() => {
    let live = true;
    setHit(null);
    if (!text.trim()) return;
    const t = setTimeout(
      () => void findCheck(tool, text).then((h) => live && setHit(h)),
      400,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tool, text]);
  if (!hit) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-action/25 bg-action-soft px-4 py-3 text-sm"
    >
      <span className="inline-flex items-center gap-2">
        <HistoryIcon size={18} className="shrink-0 text-action" />
        You already checked this on {when(hit.createdAt)}.
      </span>
      <Link
        href={openHref(hit)}
        className="font-semibold text-action hover:underline"
      >
        Open the saved result
      </Link>
    </div>
  );
}

/** Reads `?open=<id>` once and loads that saved check, with its file read again when there was one. */
export function useSavedCheck(
  tool: HistoryTool,
  onEntry: (entry: HistoryEntry, paper: LoadedPaper | null) => void,
): "idle" | "loading" | "missing" {
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    setState("loading");
    void (async () => {
      const entry = await getCheck(id);
      if (!entry || entry.tool !== tool) return setState("missing");
      let paper: LoadedPaper | null = null;
      if (entry.file) {
        try {
          paper = await loadPaper(new File([entry.file.data], entry.file.name));
        } catch {
          paper = null;
        }
      }
      onEntry(entry, paper && paper.text === entry.text ? paper : null);
      setState("idle");
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      window.history.replaceState(null, "", url);
    })();
    // Runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

/** The original file of a check, for saving with it. */
export function fileOf(
  paper: LoadedPaper | null,
): { name: string; data: Blob } | undefined {
  const doc = paper?.doc;
  if (!doc || !doc.data) return undefined;
  return { name: doc.name, data: new Blob([doc.data.slice()]) };
}
