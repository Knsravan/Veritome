"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { PlagiarismResultView } from "@/components/PlagiarismResultView";
import { SlidingChoice, StepSlider } from "@/components/motion-ui";
import { Button, Notice, Switch } from "@/components/ui";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import { glassKept, keepGlass, showGlass, useGlass } from "@/lib/ui-style";

const STRENGTH = [
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "strong", label: "Strong" },
] as const;

/**
 * Shows the site in glass while this page is open: the controls, the real home page and a real sample report.
 * Leaving the page puts the normal look back, unless the visitor chose to keep glass on.
 */
export function GlassPreview({ text, report, children }: { text: string; report: PlagiarismReport; children: ReactNode }) {
  const { showing, kept } = useGlass();
  const [on, setOn] = useState(true);
  const [strength, setStrength] = useState<(typeof STRENGTH)[number]["id"]>("balanced");
  const [view, setView] = useState<"home" | "report">("home");

  useEffect(() => {
    showGlass(true);
    return () => {
      if (!glassKept()) showGlass(false);
    };
  }, []);

  return (
    <div className="space-y-10">
      <section aria-labelledby="glass-h" className="card space-y-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <p className="text-sm font-semibold text-action">Design preview</p>
            <h1 id="glass-h" className="text-3xl font-semibold sm:text-4xl">
              Veritome in glass
            </h1>
            <p className="text-ink-soft">
              The same site with frosted, see-through panels over soft colour instead of the current raised, clay-like
              surfaces. Nothing changes for visitors: this look shows only on this page, or across the site in your
              own browser if you keep it on.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center justify-between gap-4">
              <span className="font-semibold">Glass look</span>
              <Switch
                label="Glass look"
                checked={showing}
                onChange={(v) => {
                  setOn(v);
                  if (!v && kept) keepGlass(false);
                  else showGlass(v);
                }}
              />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span>Keep it on while I browse</span>
              <Switch label="Keep glass on while I browse the site" checked={kept} disabled={!on} onChange={(v) => keepGlass(v)} />
            </label>
          </div>
        </div>
        <p className="text-sm text-ink-faint">
          Switch between light and dark with the theme button in the header to see both. The look is in{" "}
          <code>src/app/glass.css</code>.
        </p>
      </section>

      <section aria-labelledby="controls-h" className="space-y-4">
        <h2 id="controls-h" className="text-2xl font-semibold">
          Buttons and controls
        </h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="card space-y-4 p-5">
            <p className="text-sm font-semibold text-ink-soft">Buttons</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Check my paper</Button>
              <Button variant="secondary">Paste sample</Button>
              <Button variant="pillow">Download PDF</Button>
              <Button variant="glow">Copy text</Button>
              <Button variant="quiet">Learn more</Button>
              <Button busy>Checking</Button>
            </div>
          </div>
          <div className="card space-y-4 p-5">
            <p className="text-sm font-semibold text-ink-soft">Choices</p>
            <SlidingChoice
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { id: "home", label: "Home page" },
                { id: "report", label: "Sample report" },
              ]}
            />
            <StepSlider label="Rewrite strength" value={strength} onChange={setStrength} options={STRENGTH} />
            <input type="text" aria-label="Sample text field" placeholder="A text field" className="w-full rounded-xl border px-3 py-2" />
          </div>
        </div>
        <Notice kind="info" title="Notices sit on glass too">
          Warnings, limits and tips keep their colours, so they still stand out on a see-through background.
        </Notice>
      </section>

      <section aria-labelledby="page-h" className="space-y-4">
        <h2 id="page-h" className="text-2xl font-semibold">
          {view === "home" ? "The home page" : "A plagiarism report"}
        </h2>
        <p className="text-sm text-ink-soft">
          {view === "home" ? (
            <>The real home page, as visitors see it, with the glass look.</>
          ) : (
            <>A real report on the sample paper, checked against one made-up earlier draft.</>
          )}{" "}
          <Link href="/plagiarism" className="font-semibold text-action hover:underline">
            Open a tool
          </Link>{" "}
          to try it with your own text{kept ? "" : " (turn on “Keep it on” first to stay in glass)"}.
        </p>
        <div className="rounded-3xl border border-dashed border-[var(--glass-edge,var(--rule))] p-3 sm:p-5">
          {view === "home" ? children : <PlagiarismResultView text={text} report={report} />}
        </div>
      </section>
    </div>
  );
}
