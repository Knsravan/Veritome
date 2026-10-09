import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * primary: the brand colour, for the main action. secondary: soft and raised. pillow: a cushion, for downloads.
   * glow: a breathing halo on hover, for copy and quick actions. quiet: a text link.
   */
  variant?: "primary" | "secondary" | "pillow" | "glow" | "quiet";
  busy?: boolean;
};

const BUTTON_STYLES = {
  primary: "nb nb-brand",
  secondary: "nb nb-soft",
  pillow: "nb nb-pillow",
  glow: "nb nb-glow",
  quiet:
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 py-2 font-semibold text-action underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60",
} as const;

/** A button. While `busy` it presses into the page with colour sweeping through it. */
export function Button({ variant = "primary", busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BUTTON_STYLES[variant], className)}
    >
      {busy && <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}

const NOTICE_STYLES = {
  info: "border-action/25 bg-action-soft",
  warn: "border-warn/30 bg-warn-soft",
  error: "border-danger/30 bg-danger-soft",
  ok: "border-ok/30 bg-ok-soft",
} as const;

export function Notice({ kind = "info", title, children }: { kind?: keyof typeof NOTICE_STYLES; title?: string; children: ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("animate-fade-in rounded-xl border px-4 py-3 text-sm", NOTICE_STYLES[kind])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

export function Warnings({ items }: { items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <Notice kind="warn" title={items.length === 1 ? "Note" : "Notes"}>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </Notice>
  );
}

/** The standing "what this cannot tell you" panel shown beside every result. */
export function Limits({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Limits of this check" className="rounded-xl border border-dashed border-rule px-4 py-3 text-sm text-ink-soft">
      <p className="font-semibold text-ink">What this can&rsquo;t tell you</p>
      <div className="mt-1 space-y-2">{children}</div>
    </aside>
  );
}

export function ToolHeader({ title, intro, children }: { title: string; intro: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      <h1 className="animate-fade-up font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">{title}</h1>
      <p className="animate-fade-up mt-3 text-lg text-ink-soft [--i:1]">{intro}</p>
      {children && <div className="animate-fade-up [--i:2]">{children}</div>}
    </header>
  );
}

/**
 * The site's on/off toggle, drawn over a real checkbox so it works with the keyboard and screen readers. The knob
 * stretches while pressed and its cross turns into a tick when on.
 */
export function Switch({
  checked,
  disabled,
  onChange,
  label,
  describedBy,
  hue,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  describedBy?: string;
  /** The colour when on; by default the surrounding --hue, or the action colour. */
  hue?: string;
}) {
  return (
    <span className="sw" style={hue ? ({ ["--hue" as string]: hue } as CSSProperties) : undefined}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span aria-hidden className="tr">
        <span className="kn">
          <svg className="no" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          <svg className="yes" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      </span>
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3", disabled && "cursor-default opacity-60")}>
      <span className="mt-0.5">
        <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
      </span>
      <span>
        {label}
        {hint && <span className="block text-sm text-ink-faint">{hint}</span>}
      </span>
    </label>
  );
}

/** Two-column proof layout: the sheet on the left, margin notes on the right; stacked on small screens. */
export function ProofLayout({ sheet, margin }: { sheet: ReactNode; margin: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">{sheet}</div>
      <div className="min-w-0 space-y-4">{margin}</div>
    </div>
  );
}

export function Sheet({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="animate-fade-in rounded-2xl border border-[var(--neu-edge)] bg-page px-5 py-6 shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
      {children}
    </section>
  );
}
