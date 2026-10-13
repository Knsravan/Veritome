"use client";

import type { ReviewedReport } from "@/core/plagiarism/review";
import { AlertIcon } from "../icons";

/** Disguised text and paraphrasing-tool phrases: signs that copying was hidden. */
export function IntegrityFlags({ r }: { r: ReviewedReport }) {
  if (r.breakdown.disguised === 0 && r.breakdown.tortured === 0) return null;
  return (
    <section
      aria-label="Integrity flags"
      className="animate-fade-up rounded-2xl border border-danger/30 bg-danger-soft p-4 sm:p-5"
    >
      <p className="flex items-center gap-2 font-semibold text-danger">
        <AlertIcon size={18} strokeWidth={2.2} /> Signs that copying was
        hidden
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {r.issues.some((i) => i.kind === "disguised") && (
          <li>
            <span className="font-semibold">
              {r.issues.filter((i) => i.kind === "disguised").length}{" "}
              disguised passage
              {r.issues.filter((i) => i.kind === "disguised").length === 1
                ? ""
                : "s"}
            </span>
            : look-alike letters, invisible characters or hidden text.
            Veritome undid them before checking, so any copying underneath
            is still found.
          </li>
        )}
        {r.issues.some((i) => i.kind === "tortured") && (
          <li>
            <span className="font-semibold">
              {r.issues.filter((i) => i.kind === "tortured").length} phrase
              {r.issues.filter((i) => i.kind === "tortured").length === 1
                ? ""
                : "s"}{" "}
              typical of paraphrasing tools
            </span>
            , such as “{r.issues.find((i) => i.kind === "tortured")!.text}”.
            These usually mean text was reworded by a tool to hide its
            source.
          </li>
        )}
      </ul>
    </section>
  );
}
