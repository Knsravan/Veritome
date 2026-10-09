"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HistoryIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { Button, cx } from "@/components/ui";
import {
  clearChecks,
  deleteCheck,
  historyEnabled,
  listChecks,
  onHistoryChange,
  openHref,
  setHistoryEnabled,
  type HistorySummary,
  type HistoryTool,
} from "@/lib/history";

const TOOL_NAME: Record<HistoryTool, string> = {
  plagiarism: "Plagiarism",
  detector: "AI detector",
  humaniser: "Humaniser",
  paraphraser: "Paraphraser",
};

const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en", { dateStyle: "long" });
};

/** Every check saved on this device, newest first, to reopen without checking again. */
export function HistoryList() {
  const [items, setItems] = useState<HistorySummary[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState<HistoryTool | "all">("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const load = () => {
      setEnabled(historyEnabled());
      void listChecks().then(setItems);
    };
    load();
    return onHistoryChange(load);
  }, []);

  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          (filter === "all" || i.tool === filter) &&
          (!query.trim() ||
            i.title.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [items, filter, query],
  );
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: HistorySummary[] }> = [];
    for (const i of shown) {
      const d = day(i.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(i);
      else out.push({ day: d, items: [i] });
    }
    return out;
  }, [shown]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            History
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
            Your checks
          </h1>
          <p className="mt-3 text-lg text-ink-soft">
            Open any earlier check with its full report, without checking again.
          </p>
        </div>
      </header>

      <section
        aria-label="Privacy"
        className="card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"
      >
        <p className="flex max-w-2xl items-start gap-2 text-sm text-ink-soft">
          <ShieldIcon size={18} className="mt-0.5 shrink-0 text-ok" />
          Saved only in this browser on this device, never on our servers.
          Anyone who uses this browser can see it.
        </p>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setHistoryEnabled(e.target.checked)}
            className="size-4 accent-[var(--action)]"
          />
          Save my checks on this device
        </label>
      </section>

      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="radiogroup"
            aria-label="Show"
            className="neu-in inline-flex flex-wrap rounded-full p-1 text-sm"
          >
            {(["all", "plagiarism", "detector", "humaniser", "paraphraser"] as const).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={filter === t}
                  onClick={() => setFilter(t)}
                  className={cx(
                    "rounded-full px-3.5 py-1.5 font-semibold",
                    filter === t
                      ? "neu-on"
                      : "text-ink-soft hover:text-ink",
                  )}
                >
                  {t === "all" ? "All" : TOOL_NAME[t]}
                </button>
              ),
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              aria-label="Search your checks"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-56 rounded-lg border border-[var(--neu-edge)] bg-desk px-3 text-sm"
            />
            {confirmClear ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void clearChecks();
                    setConfirmClear(false);
                  }}
                >
                  Yes, delete all
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmClear(true)}>
                <TrashIcon size={16} /> Clear history
              </Button>
            )}
          </div>
        </div>
      )}

      {items === null ? (
        <div className="space-y-3" aria-label="Loading">
          {[1, 2, 3].map((k) => (
            <div
              key={k}
              className="h-20 animate-pulse rounded-2xl bg-desk-deep"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <section className="card flex flex-col items-center gap-3 p-10 text-center">
          <HistoryIcon size={36} className="text-ink-faint" />
          <h2 className="font-display text-xl font-semibold">
            No saved checks yet
          </h2>
          <p className="max-w-md text-ink-soft">
            {enabled
              ? "Checks you run with the Plagiarism tool, the AI detector, the Humaniser or the Paraphraser will appear here."
              : "Saving is switched off. Switch it on above to keep your checks on this device."}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link
              href="/plagiarism"
              className="rounded-full bg-action px-5 py-2 font-semibold text-action-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.22),var(--neu-sm)] transition-[box-shadow,transform] hover:-translate-y-px active:shadow-[inset_2px_2px_6px_rgb(0_0_0/0.25)]"
            >
              Check a paper
            </Link>
            <Link
              href="/detector"
              className="neu-sm rounded-full border border-[var(--neu-edge)] px-5 py-2 font-semibold transition-[box-shadow,transform] hover:-translate-y-px active:shadow-[var(--neu-in)]"
            >
              AI detector
            </Link>
          </div>
        </section>
      ) : shown.length === 0 ? (
        <p className="text-ink-soft">Nothing matches.</p>
      ) : (
        groups.map((g) => (
          <section key={g.day} aria-label={g.day} className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-ink-faint uppercase">
              {g.day}
            </h2>
            <ul className="space-y-2">
              {g.items.map((i) => (
                <li
                  key={i.id}
                  className="card card-hover group relative flex flex-wrap items-center gap-4 p-4 sm:p-5"
                >
                  <span className="rounded-full bg-action-soft px-2.5 py-0.5 text-xs font-semibold text-action">
                    {TOOL_NAME[i.tool]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={openHref(i)}
                      className="block truncate font-semibold after:absolute after:inset-0 after:rounded-[1rem] group-hover:underline"
                    >
                      {i.title}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {new Date(i.createdAt).toLocaleTimeString("en", {
                        timeStyle: "short",
                      })}{" "}
                      · {i.words.toLocaleString("en")} words
                    </p>
                  </div>
                  <dl className="flex gap-5">
                    {i.figures.map((f) => (
                      <div key={f.label} className="text-right">
                        <dt className="text-xs text-ink-soft">{f.label}</dt>
                        <dd className="font-display text-lg font-semibold tabular-nums">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    type="button"
                    onClick={() => void deleteCheck(i.id)}
                    aria-label={`Delete ${i.title} from history`}
                    className="relative z-10 rounded-lg p-2 text-ink-soft transition-[color,box-shadow] hover:text-ink hover:shadow-[var(--neu-sm)] active:shadow-[var(--neu-in)]"
                  >
                    <TrashIcon size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
