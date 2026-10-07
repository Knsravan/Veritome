"use client";

import { useState } from "react";
import { LOGOS, type MarkProps } from "./logos";
import "./logos.css";

function Lockup({ Mark, dark }: { Mark: (p: MarkProps) => React.ReactNode; dark?: boolean }) {
  return (
    <span className={`ll-lockup inline-flex items-center gap-2.5 ${dark ? "text-white" : "text-[#0e1320]"}`}>
      <Mark size={30} mode="idle" />
      <span className="font-display text-[1.3rem] font-bold tracking-tight">Veritome</span>
    </span>
  );
}

/** A page for choosing the new logo: each option animated, on light and dark, in the header and as a tab icon. */
export function LogoLab() {
  const [round, setRound] = useState(0);
  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold tracking-wide text-action uppercase">Logo options</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Choose Veritome&rsquo;s new logo</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Six designs, all drawn in code so they stay sharp at any size and can animate. Each is shown animating in, on light and dark, in the
          header, and as a small browser-tab icon. Tell me the number you like (or mix ideas, such as “2 with the colours of 5”).
        </p>
        <button
          type="button"
          onClick={() => setRound((r) => r + 1)}
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-action px-5 font-semibold text-action-ink shadow-[0_6px_16px_-6px_var(--action)] transition-transform hover:-translate-y-px active:scale-[0.97]"
        >
          Play all animations again
        </button>
      </header>

      <ol className="grid gap-6 lg:grid-cols-2">
        {LOGOS.map(({ id, name, idea, Mark }) => (
          <li key={id} className="card overflow-hidden">
            <div className="grid grid-cols-2">
              <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-white to-[#eef0fe]">
                <Mark key={`l${round}`} size={120} mode="intro" />
              </div>
              <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#0a0c11] to-[#1d1f3d]">
                <Mark key={`d${round}`} size={120} mode="intro" />
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-baseline gap-3">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-action text-sm font-bold text-action-ink">{id}</span>
                <h2 className="font-display text-xl font-semibold">{name}</h2>
              </div>
              <p className="text-ink-soft">{idea}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-rule bg-white px-4 py-3">
                  <Lockup Mark={Mark} />
                </div>
                <div className="rounded-xl bg-[#0a0c11] px-4 py-3">
                  <Lockup Mark={Mark} dark />
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-ink-faint">
                <span>Tab icon:</span>
                <span className="inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 border-rule bg-page px-3 py-1.5">
                  <Mark size={16} mode="static" /> <span className="text-ink-soft">Veritome</span>
                </span>
                <Mark size={32} mode="static" />
                <Mark size={48} mode="static" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
