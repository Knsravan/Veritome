import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet"; busy?: boolean };

export function Button({ variant = "primary", busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 font-semibold transition-[transform,background-color,box-shadow,opacity] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        variant === "primary" &&
          "bg-action text-action-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.22),var(--neu-sm)] hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.22),var(--shadow-card)] active:shadow-[inset_2px_2px_6px_rgb(0_0_0/0.25)]",
        variant === "secondary" &&
          "border border-[var(--neu-edge)] bg-page text-ink shadow-[var(--neu-sm)] hover:-translate-y-px hover:shadow-[var(--shadow-card)] active:shadow-[var(--neu-in)]",
        variant === "quiet" && "rounded-lg px-2 text-action underline-offset-4 hover:underline",
        className,
      )}
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
    <label className={cx("flex items-start gap-2", disabled && "opacity-60")}>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-[var(--action)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
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
    <section aria-label={label} className="animate-fade-in rounded-2xl border border-rule bg-page px-5 py-6 shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
      {children}
    </section>
  );
}
