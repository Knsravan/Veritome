"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  BookIcon,
  CompareIcon,
  DatabaseIcon,
  GlobeIcon,
  LockIcon,
  PenIcon,
  SparkIcon,
  TypeIcon,
  UserIcon,
} from "@/components/icons";
import { cx } from "@/components/ui";

export type Extra = "detector" | "citations" | "grammar" | "rewrites";

/** Each check in the colour its findings are underlined with in the report. */
const CHECKS: Array<{
  id: Extra | "plagiarism";
  label: string;
  hint: string;
  hue: string;
  Icon: (p: { size?: number }) => ReactNode;
}> = [
  {
    id: "plagiarism",
    label: "Plagiarism",
    hint: "Copied and reworded passages in published papers, the web and your documents.",
    hue: "var(--u-copied)",
    Icon: CompareIcon,
  },
  {
    id: "detector",
    label: "AI writing",
    hint: "How much of the text reads as AI-written, paragraph by paragraph.",
    hue: "var(--u-ai)",
    Icon: SparkIcon,
  },
  {
    id: "citations",
    label: "References and citations",
    hint: "Looks up every reference, flags retractions and finds claims without a citation.",
    hue: "var(--u-cite)",
    Icon: BookIcon,
  },
  {
    id: "grammar",
    label: "Grammar and spelling",
    hint: "Grammar, spelling, academic style and readability.",
    hue: "var(--u-grammar)",
    Icon: TypeIcon,
  },
  {
    id: "rewrites",
    label: "Rewrite suggestions",
    hint: "Suggested rewrites for copied passages and formulaic paragraphs.",
    hue: "var(--action)",
    Icon: PenIcon,
  },
];

const hue = (h: string) => ({ ["--hue" as string]: h }) as CSSProperties;

/** An on/off switch drawn over a real checkbox, so it works with the keyboard and screen readers. */
function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        aria-hidden
        className={cx(
          "h-6 w-11 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]",
          checked ? "bg-[var(--hue)]" : "bg-desk-deep ring-1 ring-rule ring-inset",
          disabled && !checked && "opacity-50",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </span>
  );
}

function CheckTile({
  label,
  hint,
  color,
  Icon,
  checked,
  locked,
  onChange,
}: {
  label: string;
  hint: string;
  color: string;
  Icon: (p: { size?: number }) => ReactNode;
  checked: boolean;
  locked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label
      style={hue(color)}
      className={cx(
        "group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border p-3 transition-[background-color,border-color,box-shadow,transform] duration-200",
        locked ? "cursor-default" : "hover:-translate-y-px hover:shadow-md",
        checked
          ? "border-[color-mix(in_srgb,var(--hue)_45%,transparent)] bg-[color-mix(in_srgb,var(--hue)_9%,var(--page))]"
          : "border-rule bg-page",
      )}
    >
      {/* A thin bar of the check's colour along the left edge when it is on. */}
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-2 left-0 w-1 rounded-r-full bg-[var(--hue)] transition-opacity duration-200",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "grid size-10 shrink-0 place-items-center rounded-xl transition-[background-color,color,transform] duration-200",
          checked
            ? "bg-[color-mix(in_srgb,var(--hue)_18%,var(--page))] text-[var(--hue)] group-hover:scale-105"
            : "bg-desk-deep text-ink-faint",
        )}
      >
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cx("font-semibold", !checked && "text-ink-soft")}>{label}</span>
          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-px text-[0.68rem] font-semibold text-page">
              <LockIcon size={11} /> Always on
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[0.83rem] leading-snug text-ink-soft">{hint}</span>
      </span>
      <Switch
        checked={checked}
        disabled={locked}
        onChange={onChange}
        label={locked ? `${label} (always on)` : label}
      />
    </label>
  );
}

function SourceTile({
  label,
  hint,
  Icon,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  Icon: (p: { size?: number }) => ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={hue("var(--action)")}
      className={cx(
        "flex items-center gap-3 rounded-2xl border p-3 transition-[background-color,border-color] duration-200",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        checked && !disabled ? "border-action/40 bg-action-soft/60" : "border-rule bg-page",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          checked && !disabled ? "bg-action text-action-ink" : "bg-desk-deep text-ink-faint",
        )}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-[0.8rem] leading-snug text-ink-soft">{hint}</span>
      </span>
      <Switch checked={checked && !disabled} disabled={disabled} onChange={onChange} label={label} />
    </label>
  );
}

/**
 * The "What to check" and "Compare against" choices for the full paper check: one tile per check in the colour it
 * is marked with in the report, with switches, a count, and one-click presets.
 */
export function CheckOptions({
  extras,
  onExtras,
  external,
  onExternal,
  web,
  webOn,
  onWeb,
  sources,
  author,
  onAuthor,
}: {
  extras: Record<Extra, boolean>;
  onExtras: (next: Record<Extra, boolean>) => void;
  external: boolean;
  onExternal: (v: boolean) => void;
  web: readonly string[];
  webOn: boolean;
  onWeb: (v: boolean) => void;
  sources: readonly string[];
  author: string;
  onAuthor: (v: string) => void;
}) {
  const on = 1 + Object.values(extras).filter(Boolean).length;
  const all = on === CHECKS.length;
  const set = (v: boolean) => onExtras({ detector: v, citations: v, grammar: v, rewrites: v });

  return (
    <>
      <fieldset className="space-y-3">
        {/* Floated so the legend lays out like a normal block inside the fieldset. */}
        <legend className="float-left mb-3 w-full">
          <span className="flex items-end justify-between gap-3">
            <span>
              <span className="block font-display text-lg font-semibold">What to check</span>
              <span className="block text-sm text-ink-soft">Everything lands in one report.</span>
            </span>
            <span className="rounded-full bg-desk-deep px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink-soft">
              {on} of {CHECKS.length} on
            </span>
          </span>
        </legend>
        {/* One segment per check, lit in its colour when on. */}
        <div className="clear-both flex gap-1 pt-1" aria-hidden>
          {CHECKS.map((c) => {
            const lit = c.id === "plagiarism" || extras[c.id];
            return (
              <span
                key={c.id}
                style={hue(c.hue)}
                className={cx(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  lit ? "bg-[var(--hue)]" : "bg-desk-deep",
                )}
              />
            );
          })}
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => set(true)}
            aria-pressed={all}
            className={cx(
              "rounded-full border px-3 py-1 font-semibold transition-colors",
              all ? "border-ink bg-ink text-page" : "border-rule text-ink-soft hover:text-ink",
            )}
          >
            Everything
          </button>
          <button
            type="button"
            onClick={() => set(false)}
            aria-pressed={on === 1}
            className={cx(
              "rounded-full border px-3 py-1 font-semibold transition-colors",
              on === 1 ? "border-ink bg-ink text-page" : "border-rule text-ink-soft hover:text-ink",
            )}
          >
            Plagiarism only
          </button>
        </div>
        <div className="space-y-2">
          {CHECKS.map((c) =>
            c.id === "plagiarism" ? (
              <CheckTile key={c.id} label={c.label} hint={c.hint} color={c.hue} Icon={c.Icon} checked locked />
            ) : (
              <CheckTile
                key={c.id}
                label={c.label}
                hint={c.hint}
                color={c.hue}
                Icon={c.Icon}
                checked={extras[c.id]}
                onChange={(v) => onExtras({ ...extras, [c.id]: v })}
              />
            ),
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-display text-lg font-semibold">Compare against</legend>
        <SourceTile
          label="Scholarly databases"
          hint={`${sources.join(", ")}. Asks before sending anything.`}
          Icon={DatabaseIcon}
          checked={external}
          onChange={onExternal}
        />
        <SourceTile
          label="The open web"
          hint={web.length ? `Searched with ${web.join(" and ")}.` : "Not enabled on this server."}
          Icon={GlobeIcon}
          checked={webOn}
          disabled={!external || web.length === 0}
          onChange={onWeb}
        />
        <label
          className={cx(
            "block rounded-2xl border border-rule bg-page p-3 transition-opacity",
            !external && "opacity-60",
          )}
        >
          <span className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-desk-deep text-ink-faint">
              <UserIcon size={18} />
            </span>
            <span>
              <span className="block font-semibold">Your earlier papers</span>
              <span className="block text-[0.8rem] leading-snug text-ink-soft">
                Optional. Finds text reused from your own published work.
              </span>
            </span>
          </span>
          <input
            type="text"
            value={author}
            onChange={(e) => onAuthor(e.target.value)}
            disabled={!external}
            placeholder="ORCID iD or your full name"
            autoComplete="name"
            className="mt-2.5 w-full rounded-lg border border-rule bg-desk/60 px-3 py-2 text-sm transition-colors focus:border-action"
          />
        </label>
      </fieldset>
    </>
  );
}
