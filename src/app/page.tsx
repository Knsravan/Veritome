import Link from "next/link";
import { ArrowRightIcon, CheckIcon, FileIcon, ShieldIcon, UploadIcon } from "@/components/icons";
import { TOOLS } from "@/lib/tools";

const EXAMPLE_SCORES = [
  { label: "Similarity", value: "14", unit: "%", note: "3 matching sources", bar: 14, tone: "bg-warn" },
  { label: "AI patterns", value: "8", unit: "/100", note: "Few patterns", bar: 8, tone: "bg-ok" },
  { label: "References", value: "23", unit: "/24", note: "1 to check by hand", bar: 96, tone: "bg-ok" },
];

function ExampleReport() {
  return (
    <figure aria-label="Example of a Veritome report" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Example report</p>
        <p className="text-xs text-ink-faint">4,812 words</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
        {EXAMPLE_SCORES.map((s) => (
          <div key={s.label} className="px-4 py-3.5">
            <p className="text-xs font-semibold text-ink-soft">{s.label}</p>
            <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">
              {s.value}
              <span className="text-sm font-normal text-ink-faint">{s.unit}</span>
            </p>
            <span aria-hidden className="mt-2 block h-1 rounded-full bg-desk-deep">
              <span className={`block h-full rounded-full ${s.tone}`} style={{ width: `${s.bar}%` }} />
            </span>
            <p className="mt-1.5 text-xs text-ink-faint">{s.note}</p>
          </div>
        ))}
      </div>
      <div className="px-5 py-5 sm:px-6">
        <p className="sheet-text text-[0.98rem]">
          Late-season respiration stayed high in alder stands near the river.{" "}
          <span className="mark mark-match" data-src="1">
            Riparian zones account for a large share of soil carbon efflux in temperate catchments
          </span>{" "}
          <span className="mark mark-cite">(Smith &amp; Lee, 2021)</span>.{" "}
          <span className="mark mark-ai">Moreover, it is important to note that this plays a pivotal role</span> in regional budgets. The{" "}
          <span className="mark mark-grammar">the</span> litter-bag data were meant to close the gap.
        </p>
      </div>
      <figcaption className="grid gap-px border-t border-rule bg-rule text-sm sm:grid-cols-2">
        {[
          ["border-[var(--src-1-line)]", "Matches source 1", "14 words, linked to the paper it came from."],
          ["border-cite", "Year mismatch", "Your reference list says 2020."],
          ["border-ai", "Formulaic phrasing", "Shown with how sure the model is."],
          ["border-grammar", "Repeated word", "With a one-click fix."],
        ].map(([c, t, d]) => (
          <p key={t} className={`border-l-4 bg-page px-4 py-2.5 ${c}`}>
            <span className="font-semibold">{t}.</span> <span className="text-ink-soft">{d}</span>
          </p>
        ))}
      </figcaption>
    </figure>
  );
}

const STEPS = [
  { icon: <UploadIcon size={20} />, title: "Upload your paper", text: "Word, PDF, LaTeX or plain text. Paste it if you prefer." },
  { icon: <FileIcon size={20} />, title: "We check it", text: "Against millions of papers, your references against the databases they cite, and your writing against trained models." },
  { icon: <CheckIcon size={20} />, title: "Fix what matters", text: "A ranked list of what to fix first, every finding marked in your text, and a PDF to keep." },
];

export default function Home() {
  return (
    <div className="space-y-24">
      <section className="grid items-center gap-12 pt-2 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-rule bg-page px-3 py-1 text-sm text-ink-soft">
            <span className="size-2 rounded-full bg-ok" aria-hidden /> Free and open source
          </p>
          <h1 className="mt-5 font-serif text-4xl leading-[1.1] font-semibold tracking-tight sm:text-[3.4rem]">Check your paper before reviewers do.</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-soft">
            One upload checks for copied and reworded passages, AI-style writing, broken or retracted references and grammar slips. You get a clear
            report with every finding marked in your text, and an honest note on how sure each one is.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/report" className="inline-flex h-12 items-center gap-2 rounded-md bg-action px-6 font-semibold text-action-ink shadow-sm hover:opacity-90">
              Check your paper <ArrowRightIcon />
            </Link>
            <Link href="/report?sample=1" className="inline-flex h-12 items-center rounded-md border border-rule bg-page px-6 font-semibold hover:bg-desk-deep">
              Try it with a sample
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
            {["No account needed", "Nothing stored", "Results in minutes"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckIcon size={16} className="text-ok" strokeWidth={2.4} /> {t}
              </li>
            ))}
          </ul>
        </div>
        <ExampleReport />
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="font-serif text-3xl font-semibold">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-action-soft text-action">{s.icon}</span>
                <span className="text-sm font-semibold text-ink-faint">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-ink-soft">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="tools-title" className="font-serif text-3xl font-semibold">
              Six tools, each honest about its limits
            </h2>
            <p className="mt-2 max-w-2xl text-ink-soft">
              Use them together in one report, or one at a time. No checker is right every time, commercial ones included, so each tool tells you what it cannot see.
            </p>
          </div>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.href} className="card group relative flex flex-col p-6 transition-colors hover:border-ink-faint/60">
              <h3 className="text-lg font-semibold">
                <Link href={t.href} className="after:absolute after:inset-0 after:rounded-[0.75rem] focus-visible:outline-none group-focus-within:underline">
                  {t.name}
                </Link>
              </h3>
              <p className="mt-2">{t.does}</p>
              <p className="mt-3 border-t border-rule pt-3 text-sm text-ink-soft">
                <span className="font-semibold text-ink">Limit: </span>
                {t.cannot}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-action">
                Open {t.name} <ArrowRightIcon size={16} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="privacy-title" className="card grid gap-8 p-8 md:grid-cols-[auto_1fr_1fr_1fr] md:items-start">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-ok-soft text-ok">
          <ShieldIcon size={24} />
        </span>
        <h2 id="privacy-title" className="sr-only">
          Privacy
        </h2>
        <div>
          <h3 className="font-semibold">Nothing is kept</h3>
          <p className="mt-1 text-ink-soft">Text and files are processed in memory and dropped when the check finishes. Nothing is logged.</p>
        </div>
        <div>
          <h3 className="font-semibold">You decide what leaves</h3>
          <p className="mt-1 text-ink-soft">Checks that search outside databases ask first and tell you which services see which parts of your text.</p>
        </div>
        <div>
          <h3 className="font-semibold">Run it yourself</h3>
          <p className="mt-1 text-ink-soft">Confidential manuscript? Run Veritome on your own computer with Docker, with a local language model.</p>
        </div>
      </section>
    </div>
  );
}
