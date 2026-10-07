"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { LOGOS, type MarkProps } from "./logos";
import "./logos.css";

function Lockup({ Mark, dark }: { Mark: (p: MarkProps) => ReactNode; dark?: boolean }) {
  return (
    <span className={`ll-lockup inline-flex items-center gap-2.5 ${dark ? "text-white" : "text-[#0e1320]"}`}>
      <Mark size={34} mode="idle" />
      <span className="font-display text-[1.35rem] font-bold tracking-tight">Veritome</span>
    </span>
  );
}

/** A dark spotlight stage; the logo tilts gently towards the pointer. */
function Stage({ children, light }: { children: ReactNode; light?: boolean }) {
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ rx: ((e.clientY - r.top) / r.height - 0.5) * -18, ry: ((e.clientX - r.left) / r.width - 0.5) * 18 });
  };
  return (
    <div
      onMouseMove={move}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      className={`ll-stage relative flex h-64 items-center justify-center overflow-hidden sm:h-72 ${
        light ? "bg-[radial-gradient(circle_at_50%_40%,#ffffff,#e9e7ff_70%)]" : "bg-[radial-gradient(circle_at_50%_38%,#2a2470,#0b0a1f_65%)]"
      }`}
    >
      {!light && <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[size:28px_28px]" />}
      <div className="ll-tilt relative" style={{ ["--rx" as string]: `${tilt.rx}deg`, ["--ry" as string]: `${tilt.ry}deg` }}>
        {children}
      </div>
    </div>
  );
}

/** A page for choosing the new logo: each option animated on a stage, in the header and as a tab icon. */
export function LogoLab() {
  const [round, setRound] = useState(0);
  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold tracking-wide text-action uppercase">Logo options · round 2</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Choose Veritome&rsquo;s new logo</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Six premium marks with depth, glass and light, all drawn in code so they stay sharp at any size and keep moving softly. Move your mouse
          over a stage to tilt the logo. Tell me the number you like, or mix ideas.
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
            <div className="grid grid-cols-[1.6fr_1fr]">
              <Stage>
                <Mark key={`d${round}`} size={190} mode="intro" />
              </Stage>
              <Stage light>
                <Mark key={`l${round}`} size={110} mode="intro" />
              </Stage>
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
                <div className="rounded-xl bg-[#0b0a1f] px-4 py-3">
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
