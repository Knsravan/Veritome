"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { StepSlider } from "@/components/motion-ui";
import "./neu-kit.css";

function Choice({ letter, name, note, children }: { letter: string; name: string; note: string; children: ReactNode }) {
  return (
    <div className="card nk-hi flex flex-col gap-5 p-6">
      <div className="flex items-baseline gap-3">
        <span className="neu-in grid size-9 shrink-0 place-items-center rounded-full font-display text-lg font-bold text-action">
          {letter}
        </span>
        <div>
          <h3 className="font-semibold">{name}</h3>
          <p className="text-sm text-ink-soft">{note}</p>
        </div>
      </div>
      <div className="flex min-h-24 flex-wrap items-center justify-center gap-5">{children}</div>
    </div>
  );
}

function Group({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div>
        <h2 id={id} className="font-display text-2xl font-semibold">
          {title}
        </h2>
        <p className="text-ink-soft">{intro}</p>
      </div>
      <div className="nk-hi grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function RoundButton() {
  const [ripples, setRipples] = useState<number[]>([]);
  return (
    <button
      type="button"
      aria-label="Like"
      className="nb nb-round"
      onClick={() => {
        const id = Date.now();
        setRipples((r) => [...r, id]);
        setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), 650);
      }}
    >
      {ripples.map((r) => (
        <span key={r} className="nb-ripple" />
      ))}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 21s-7-4.4-9.3-9A5.4 5.4 0 0 1 12 6.6 5.4 5.4 0 0 1 21.3 12C19 16.6 12 21 12 21z" />
      </svg>
    </button>
  );
}

function LatchButtons() {
  const [on, setOn] = useState<Record<string, boolean>>({ Bold: true });
  return (
    <div className="flex gap-3">
      {["Bold", "Italic"].map((k) => (
        <button key={k} type="button" aria-pressed={!!on[k]} className="nb nb-latch" onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))}>
          {k}
        </button>
      ))}
    </div>
  );
}

function ProgressButton() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      className="nb nb-progress"
      data-state={state}
      aria-live="polite"
      onClick={() => {
        if (state === "busy") return;
        if (state === "done") return setState("idle");
        setState("busy");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("done"), 1850);
      }}
    >
      <span className="nb-fill" aria-hidden />
      <span>{state === "idle" ? "Check paper" : state === "busy" ? "Checking…" : "Done ✓"}</span>
    </button>
  );
}

function Toggle({ kind, label, defaultOn, children }: { kind: string; label: string; defaultOn?: boolean; children: ReactNode }) {
  return (
    <label className={`nt nt-${kind}`}>
      <input type="checkbox" role="switch" defaultChecked={defaultOn} />
      {children}
      <span>{label}</span>
    </label>
  );
}

const Cross = () => (
  <svg className="no" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const Tick = () => (
  <svg className="yes" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function RangeSlider({ bubble, label }: { bubble?: boolean; label: string }) {
  const [v, setV] = useState(bubble ? 35 : 60);
  const style = { "--p": `${v}%`, "--v": v / 100 } as CSSProperties;
  const input = (
    <input type="range" min={0} max={100} value={v} aria-label={label} onChange={(e) => setV(Number(e.target.value))} className="ns" style={style} />
  );
  if (!bubble) {
    return (
      <div className="w-full space-y-2">
        <div className="flex justify-between text-sm font-semibold">
          <span>{label}</span>
          <span className="text-action tabular-nums">{v}%</span>
        </div>
        {input}
      </div>
    );
  }
  return (
    <div className="ns-bubble-wrap w-full" style={style}>
      <span className="ns-bubble tabular-nums" aria-hidden>
        {v}%
      </span>
      {input}
    </div>
  );
}

function CapsuleSlider() {
  const [v, setV] = useState(45);
  return (
    <div className="ns-cap w-full">
      <div className="fill tabular-nums" style={{ width: `${v}%` }}>
        {v}%
      </div>
      <input type="range" min={0} max={100} value={v} aria-label="Volume" onChange={(e) => setV(Number(e.target.value))} />
    </div>
  );
}

const DIAL_SPAN = 270;
function Dial() {
  const [v, setV] = useState(40);
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const set = (n: number) => setV(Math.round(Math.min(100, Math.max(0, n))));
  const fromPointer = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    let a = (Math.atan2(x - (r.left + r.width / 2), -(y - (r.top + r.height / 2))) * 180) / Math.PI; // 0 at the top
    a = Math.min(DIAL_SPAN / 2, Math.max(-DIAL_SPAN / 2, a));
    set(((a + DIAL_SPAN / 2) / DIAL_SPAN) * 100);
  };
  const angle = (v / 100) * DIAL_SPAN - DIAL_SPAN / 2;
  const ticks = 21;
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label="Dial"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className="ns-dial"
      style={{ cursor: drag ? "grabbing" : undefined }}
      onKeyDown={(e) => {
        const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 20, PageDown: -20 }[e.key];
        if (step !== undefined) {
          e.preventDefault();
          set(v + step);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          set(e.key === "Home" ? 0 : 100);
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        fromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => drag && fromPointer(e.clientX, e.clientY)}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
    >
      {Array.from({ length: ticks }, (_, i) => {
        const a = (i / (ticks - 1)) * DIAL_SPAN - DIAL_SPAN / 2;
        return (
          <span
            key={i}
            className={`tick${(i / (ticks - 1)) * 100 <= v ? " lit" : ""}`}
            style={{ transform: `rotate(${a}deg) translateY(-4.1rem)` }}
          />
        );
      })}
      <div className="face" style={{ transform: `rotate(${angle}deg)` }} />
      <span className="val tabular-nums">{v}</span>
    </div>
  );
}

const STEPS = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "strong", label: "Strong" },
] as const;

export function StyleGallery() {
  const [step, setStep] = useState<(typeof STEPS)[number]["id"]>("medium");
  return (
    <div className="space-y-16">
      <Group id="g-buttons" title="Buttons" intro="Hover, press and hold, and click each one.">
        <Choice letter="A" name="Soft" note="Rises when you hover, sinks into the page when pressed.">
          <button type="button" className="nb nb-soft">Upload a file</button>
        </Choice>
        <Choice letter="B" name="Brand" note="The main colour, raised, with a pressed-in click.">
          <button type="button" className="nb nb-brand">
            Check paper <Arrow />
          </button>
        </Choice>
        <Choice letter="C" name="Pillow" note="Bulges out like a cushion and turns hollow when pressed.">
          <button type="button" className="nb nb-convex">Download</button>
        </Choice>
        <Choice letter="D" name="Round icon" note="A raised disc with a colour ripple when you click.">
          <RoundButton />
        </Choice>
        <Choice letter="E" name="Glow" note="A soft coloured halo breathes around it on hover.">
          <button type="button" className="nb nb-glow">Humanise</button>
        </Choice>
        <Choice letter="F" name="Latch" note="Stays pressed in while it is on, like a real button.">
          <LatchButtons />
        </Choice>
        <Choice letter="G" name="Progress" note="Fills with colour while working, then shows it is done. Click again to reset.">
          <ProgressButton />
        </Choice>
      </Group>

      <Group id="g-toggles" title="Toggles" intro="Click each one, or use Tab and Space.">
        <Choice letter="A" name="Classic" note="A pressed-in track that fills with colour, and a springy knob.">
          <Toggle kind="a" label="Use AI" defaultOn>
            <span className="tr">
              <span className="kn" />
            </span>
          </Toggle>
        </Choice>
        <Choice letter="B" name="Stretchy" note="The knob stretches while you press, and the cross turns into a tick.">
          <Toggle kind="b" label="Keep citations" defaultOn>
            <span className="tr">
              <span className="kn">
                <Cross />
                <Tick />
              </span>
            </span>
          </Toggle>
        </Choice>
        <Choice letter="C" name="Rocker" note="Two halves; the chosen half is pressed into the page.">
          <Toggle kind="c" label="Exclude quotes">
            <span className="tr">
              <span className="off">OFF</span>
              <span className="on">ON</span>
            </span>
          </Toggle>
        </Choice>
        <Choice letter="D" name="Light" note="All grey and calm, with a small light on the knob that glows when on.">
          <Toggle kind="d" label="Web sources" defaultOn>
            <span className="tr">
              <span className="kn" />
            </span>
          </Toggle>
        </Choice>
        <Choice letter="E" name="Tick box" note="A raised square that presses in and draws a tick.">
          <Toggle kind="e" label="Databases" defaultOn>
            <span className="tr">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          </Toggle>
        </Choice>
        <Choice letter="F" name="Power" note="A round button that presses in and lights up.">
          <Toggle kind="f" label="Track changes">
            <span className="tr">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0" />
              </svg>
            </span>
          </Toggle>
        </Choice>
      </Group>

      <Group id="g-sliders" title="Sliders" intro="Drag each one, or click it and use the arrow keys.">
        <Choice letter="A" name="Classic" note="A pressed-in groove that fills with colour, and a raised knob.">
          <RangeSlider label="Similarity" />
        </Choice>
        <Choice letter="B" name="Bubble" note="A raised bubble with the number pops up while you use it.">
          <RangeSlider bubble label="Minimum match" />
        </Choice>
        <Choice letter="C" name="Steps" note="Snaps to named steps (the one on the Paraphraser now).">
          <div className="w-full">
            <StepSlider label="Strength" value={step} options={STEPS} onChange={setStep} />
          </div>
        </Choice>
        <Choice letter="D" name="Capsule" note="A thick well that fills with a raised colour bar showing the number.">
          <CapsuleSlider />
        </Choice>
        <Choice letter="E" name="Dial" note="A knob you turn, with a ring of lights. Good for a single setting.">
          <Dial />
        </Choice>
      </Group>
    </div>
  );
}
