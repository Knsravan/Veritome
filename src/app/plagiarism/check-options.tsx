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
} from "@/components/icons";
import { Switch } from "@/components/motion-ui";
import { cx } from "@/components/ui";

export type Extra = "detector" | "citations" | "grammar" | "rewrites";

/** Each check in the colour its findings are underlined with in the report. */
const CHECKS: Array<{
  id: Extra | "plagiarism";
  label: string;
  hint: string;
  /** The longer description, shown on hover and read by screen readers. */
  full: string;
  hue: string;
  Icon: (p: { size?: number }) => ReactNode;
}> = [
  {
    id: "plagiarism",
    label: "Plagiarism",
    hint: "Copied and reworded text",
    full: "Copied and reworded passages in published papers, the web and your documents.",
    hue: "var(--u-copied)",
    Icon: CompareIcon,
  },
  {
    id: "detector",
    label: "AI writing",
    hint: "AI-written paragraphs",
    full: "How much of the text reads as AI-written, paragraph by paragraph.",
    hue: "var(--u-ai)",
    Icon: SparkIcon,
  },
  {
    id: "citations",
    label: "References and citations",
    hint: "References, retractions, uncited claims",
    full: "Looks up every reference, flags retractions and finds claims without a citation.",
    hue: "var(--u-cite)",
    Icon: BookIcon,
  },
  {
    id: "grammar",
    label: "Grammar and spelling",
    hint: "Grammar, spelling and style",
    full: "Grammar, spelling, academic style and readability.",
    hue: "var(--u-grammar)",
    Icon: TypeIcon,
  },
  {
    id: "rewrites",
    label: "Rewrite suggestions",
    hint: "Fixes for flagged passages",
    full: "Suggested rewrites for copied passages and formulaic paragraphs.",
    hue: "var(--action)",
    Icon: PenIcon,
  },
];

const hue = (h: string) => ({ ["--hue" as string]: h }) as CSSProperties;

function CheckRow({
  id,
  label,
  hint,
  full,
  color,
  Icon,
  checked,
  locked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  full: string;
  color: string;
  Icon: (p: { size?: number }) => ReactNode;
  checked: boolean;
  locked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label
      style={hue(color)}
      title={full}
      className={cx(
        "group relative flex items-center gap-2.5 overflow-hidden rounded-xl border py-1.5 pr-2.5 pl-3 transition-[background-color,border-color] duration-200",
        locked ? "cursor-default" : "cursor-pointer",
        checked
          ? "border-[color-mix(in_srgb,var(--hue)_40%,transparent)] bg-[color-mix(in_srgb,var(--hue)_8%,var(--page))]"
          : "border-rule bg-page hover:bg-desk",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--hue)] transition-opacity duration-200",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-200",
          checked ? "bg-[color-mix(in_srgb,var(--hue)_16%,var(--page))] text-[var(--hue)]" : "bg-desk-deep text-ink-faint",
        )}
      >
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className={cx("truncate text-sm font-semibold", !checked && "text-ink-soft")}>{label}</span>
          {locked && <LockIcon size={12} className="shrink-0 text-ink-faint" />}
        </span>
        <span className="block truncate text-xs text-ink-soft">{hint}</span>
        <span id={`${id}-d`} className="sr-only">
          {full}
          {locked ? " Always on." : ""}
        </span>
      </span>
      <Switch checked={checked} disabled={locked} onChange={onChange} label={label} describedBy={`${id}-d`} />
    </label>
  );
}

function SourceChip({
  label,
  name,
  Icon,
  checked,
  disabled,
  onChange,
  title,
}: {
  label: string;
  /** The full name the switch is announced with. */
  name: string;
  Icon: (p: { size?: number }) => ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title: string;
}) {
  const on = checked && !disabled;
  return (
    <label
      style={hue("var(--action)")}
      title={title}
      className={cx(
        "flex min-w-0 items-center gap-2 rounded-xl border py-2 pr-2 pl-2.5 transition-[background-color,border-color] duration-200",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        on ? "border-action/40 bg-action-soft/70" : "border-rule bg-page",
      )}
    >
      <span aria-hidden className={cx("shrink-0", on ? "text-action" : "text-ink-faint")}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
      <Switch checked={on} disabled={disabled} onChange={onChange} label={name} />
    </label>
  );
}

/**
 * The "What to check" and "Compare against" choices for the full paper check, kept compact so the card sits level
 * with the upload box: one slim row per check in the colour it is marked with in the report, presets, and the
 * sources as two switches.
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
}: {
  extras: Record<Extra, boolean>;
  onExtras: (next: Record<Extra, boolean>) => void;
  external: boolean;
  onExternal: (v: boolean) => void;
  web: readonly string[];
  webOn: boolean;
  onWeb: (v: boolean) => void;
  sources: readonly string[];
}) {
  const on = 1 + Object.values(extras).filter(Boolean).length;
  const set = (v: boolean) => onExtras({ detector: v, citations: v, grammar: v, rewrites: v });
  const preset = (active: boolean) =>
    cx(
      "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
      active ? "border-ink bg-ink text-page" : "border-rule text-ink-soft hover:text-ink",
    );

  return (
    <>
      <fieldset className="min-w-0 space-y-2">
        {/* Floated so the legend lays out like a normal block inside the fieldset. */}
        <legend className="float-left w-full">
          <span className="flex items-center justify-between gap-2">
            <span className="font-display text-lg font-semibold">What to check</span>
            <span className="flex gap-1.5">
              <button type="button" onClick={() => set(true)} aria-pressed={on === CHECKS.length} className={preset(on === CHECKS.length)}>
                All
              </button>
              <button type="button" onClick={() => set(false)} aria-pressed={on === 1} className={preset(on === 1)}>
                Plagiarism only
              </button>
            </span>
          </span>
        </legend>
        {/* One segment per check, lit in its colour when on. */}
        <div className="clear-both flex items-center gap-1 pt-1" aria-hidden>
          {CHECKS.map((c) => (
            <span
              key={c.id}
              style={hue(c.hue)}
              className={cx(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                c.id === "plagiarism" || extras[c.id] ? "bg-[var(--hue)]" : "bg-desk-deep",
              )}
            />
          ))}
          <span className="ml-1.5 text-xs font-semibold tabular-nums text-ink-soft">
            {on}/{CHECKS.length}
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          {on} of {CHECKS.length} checks on
        </p>
        <div className="space-y-1.5">
          {CHECKS.map((c) =>
            c.id === "plagiarism" ? (
              <CheckRow key={c.id} id={`chk-${c.id}`} label={c.label} hint={c.hint} full={c.full} color={c.hue} Icon={c.Icon} checked locked />
            ) : (
              <CheckRow
                key={c.id}
                id={`chk-${c.id}`}
                label={c.label}
                hint={c.hint}
                full={c.full}
                color={c.hue}
                Icon={c.Icon}
                checked={extras[c.id]}
                onChange={(v) => onExtras({ ...extras, [c.id]: v })}
              />
            ),
          )}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="float-left w-full font-display text-lg font-semibold">Compare against</legend>
        <div className="clear-both grid grid-cols-2 gap-1.5 pt-1">
          <SourceChip
            label="Databases"
            name="Scholarly databases"
            title={`Scholarly databases: ${sources.join(", ")}.`}
            Icon={DatabaseIcon}
            checked={external}
            onChange={onExternal}
          />
          <SourceChip
            label="Open web"
            name="The open web"
            title={web.length ? `Searched with ${web.join(" and ")}.` : "Not enabled on this server."}
            Icon={GlobeIcon}
            checked={webOn}
            disabled={!external || web.length === 0}
            onChange={onWeb}
          />
        </div>
        <p className="truncate text-xs text-ink-soft" title={sources.join(", ")}>
          {sources.slice(0, 3).join(", ")} and more. Asks first.
        </p>
      </fieldset>
    </>
  );
}
