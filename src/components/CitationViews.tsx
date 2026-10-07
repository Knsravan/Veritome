"use client";

import { useState } from "react";
import type { CitationCrossCheck } from "@/core/citations/intext";
import { formatBibtex, formatReferenceText } from "@/core/citations/format";
import { CITATION_STYLES, type CitationStyle, type Work } from "@/core/citations/types";
import type { ReferenceCheck, VerifyListResult, VerifyStatus } from "@/core/citations/verify";
import { cx } from "./ui";

export const STATUS_TEXT: Record<VerifyStatus, { label: string; tone: string; help: string }> = {
  verified: { label: "Verified", tone: "border-ok text-ok", help: "Matches a database record closely." },
  likely: { label: "Probably right", tone: "border-ok text-ok", help: "A similar record exists; some details differ." },
  mismatch: { label: "DOI points elsewhere", tone: "border-danger text-danger", help: "The DOI resolves to a different work than the one cited." },
  not_found: { label: "Not found", tone: "border-warn text-warn", help: "Nothing similar in the databases. Books and reports are often missing, so check by hand." },
  unchecked: { label: "Not checked", tone: "border-rule text-ink-faint", help: "A lookup service failed, so nothing can be said." },
};

const FLAG_TEXT: Record<string, string> = {
  retracted: "Retracted",
  withdrawn: "Withdrawn",
  removed: "Removed",
  expression_of_concern: "Expression of concern",
  doi_not_found: "DOI not registered",
  doi_points_elsewhere: "DOI points to another work",
  duplicate: "Duplicate entry",
  incomplete_reference: "Incomplete entry",
};

export function StylePicker({ value, onChange }: { value: CitationStyle; onChange: (s: CitationStyle) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      Citation style
      <select value={value} onChange={(e) => onChange(e.target.value as CitationStyle)} className="rounded border border-rule bg-page px-2 py-1">
        {CITATION_STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-action underline-offset-4 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function WorkCitation({ work, style }: { work: Work; style: CitationStyle }) {
  const formatted = formatReferenceText(work, style, 1);
  return (
    <div className="space-y-1">
      <p className="font-serif">{formatted}</p>
      <p className="flex flex-wrap gap-4 text-sm">
        <CopyButton text={formatted} label="Copy reference" />
        <CopyButton text={formatBibtex(work)} label="Copy BibTeX" />
        {(work.url || work.doi) && (
          <a className="text-action underline-offset-4 hover:underline" href={work.doi ? `https://doi.org/${work.doi}` : work.url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
      </p>
    </div>
  );
}

function CheckItem({ c, style }: { c: ReferenceCheck; style: CitationStyle }) {
  const s = STATUS_TEXT[c.status];
  const serious = c.flags.filter((f) => ["retracted", "withdrawn", "removed", "expression_of_concern", "doi_points_elsewhere"].includes(f));
  return (
    <li className={cx("rounded border-l-4 bg-page px-4 py-3", serious.length ? "border-danger" : s.tone.split(" ")[0])}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular-nums text-ink-faint">[{c.index}]</span>
        <span className={cx("rounded border px-1.5 text-xs font-semibold", s.tone)}>{s.label}</span>
        {c.flags.map((f) => (
          <span key={f} className={cx("rounded px-1.5 text-xs font-semibold", serious.includes(f) ? "bg-danger-soft text-danger" : "bg-desk text-ink-soft")}>
            {FLAG_TEXT[f] ?? f}
          </span>
        ))}
      </div>
      <p className="mt-2 font-serif text-[0.95rem]">{c.raw}</p>
      {c.discrepancies.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {c.discrepancies.map((d, i) => (
            <li key={i}>
              {d.field}: you have <strong>{d.cited ?? "nothing"}</strong>, the record says <strong>{d.actual ?? "nothing"}</strong>
            </li>
          ))}
        </ul>
      )}
      {c.notes.length > 0 && <p className="mt-1 text-sm text-ink-soft">{c.notes.join(" ")}</p>}
      {c.match && (c.status === "likely" || c.status === "mismatch" || c.discrepancies.length > 0) && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-action">Record found in the database</summary>
          <div className="mt-2">
            <WorkCitation work={c.match} style={style} />
          </div>
        </details>
      )}
      {c.status === "not_found" && <p className="mt-1 text-sm text-ink-faint">{s.help}</p>}
    </li>
  );
}

export function VerifyView({ result, crossCheck }: { result: VerifyListResult; crossCheck: CitationCrossCheck | null }) {
  const [style, setStyle] = useState<CitationStyle>("apa");
  const [only, setOnly] = useState(false);
  const { counts } = result;
  const shown = only ? result.checks.filter((c) => c.status !== "verified" || c.flags.length > 0) : result.checks;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Verified or close", counts.verified + counts.likely],
            ["Not found", counts.not_found],
            ["DOI mismatch", counts.mismatch],
            ["Flagged", counts.flagged],
            ["Not checked", counts.unchecked],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded bg-page px-3 py-2">
            <dt className="text-sm text-ink-soft">{k}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {crossCheck && <CrossCheckView check={crossCheck} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="size-4 accent-[var(--action)]" />
          Only show entries that need attention
        </label>
        <StylePicker value={style} onChange={setStyle} />
      </div>
      <ol className="space-y-3">
        {shown.map((c) => (
          <CheckItem key={c.index} c={c} style={style} />
        ))}
      </ol>
    </div>
  );
}

export function CrossCheckView({ check }: { check: CitationCrossCheck }) {
  const items: string[] = [];
  for (const m of check.citedButMissing) items.push(`“${m.citation.raw}” in the text: ${m.reason}`);
  for (const r of check.uncitedReferences) items.push(`Entry ${r.index} is never cited in the text: ${r.raw.slice(0, 120)}${r.raw.length > 120 ? "…" : ""}`);
  if (check.numbersOutOfOrder) items.push("Numbered citations do not first appear in order 1, 2, 3, …");
  return (
    <section aria-labelledby="xc-h" className="rounded border border-rule bg-page px-4 py-3 text-sm">
      <h3 id="xc-h" className="font-semibold">
        Text and reference list ({check.citations.length} in-text citation{check.citations.length === 1 ? "" : "s"}, {check.style === "none" ? "no style detected" : `${check.style} style`})
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-ink-soft">Every in-text citation has an entry, and every entry is cited.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {check.warnings.map((w) => (
        <p key={w} className="mt-1 text-ink-faint">
          {w}
        </p>
      ))}
    </section>
  );
}
