import Link from "next/link";
import { TOOLS } from "@/lib/tools";

function DemoProof() {
  return (
    <figure aria-label="Example of a checked paragraph" className="relative">
      <div className="rounded-sm bg-page px-6 py-7 shadow-[0_1px_0_var(--rule),0_18px_40px_-20px_rgb(0_0_0/0.35)] sm:px-8">
        <p className="sheet-text text-[1rem]">
          Late-season respiration stayed high in alder stands near the river.{" "}
          <span className="mark mark-match">Riparian zones account for a large share of soil carbon efflux in temperate catchments</span>{" "}
          <span className="mark mark-cite">(Smith &amp; Lee, 2021)</span>.{" "}
          <span className="mark mark-ai">Moreover, it is important to note that this plays a pivotal role</span> in regional budgets. The{" "}
          <span className="mark mark-grammar">the</span> litter-bag data were meant to close the gap.
        </p>
      </div>
      <figcaption className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <p className="border-l-4 border-match-line pl-3">
          <span className="font-semibold">Matches a source</span> over 14 words, with a link to the abstract it came from.
        </p>
        <p className="border-l-4 border-cite pl-3">
          <span className="font-semibold">Year mismatch:</span> the reference list says 2020.
        </p>
        <p className="border-l-4 border-ai pl-3">
          <span className="font-semibold">Formulaic phrasing</span>, a weak signal shown with its uncertainty.
        </p>
        <p className="border-l-4 border-grammar pl-3">
          <span className="font-semibold">Repeated word</span>, with a one-click fix.
        </p>
      </figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h1 className="font-serif text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">Check your paper before reviewers do.</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-soft">
            Veritome looks for overlap with published work, formulaic AI-style writing, shaky references and grammar slips. Every flag
            comes with its evidence and an honest note on how sure it is.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/report" className="rounded bg-action px-5 py-3 font-semibold text-action-ink hover:opacity-90">
              Check a whole paper
            </Link>
            <a href="#tools" className="rounded border border-rule bg-page px-5 py-3 font-semibold hover:bg-desk-deep">
              Use one tool
            </a>
          </div>
          <p className="mt-6 max-w-xl text-sm text-ink-faint">
            Free and open source. Run it on your own computer with Docker if your manuscript is confidential.
          </p>
        </div>
        <DemoProof />
      </section>

      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-8">
        <h2 id="tools-title" className="font-serif text-3xl font-semibold">
          The six checks, and where each one stops
        </h2>
        <p className="mt-2 max-w-2xl text-ink-soft">
          No checker is right every time, commercial ones included. Knowing what a tool cannot see matters as much as what it finds.
        </p>
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {TOOLS.map((t) => (
            <li key={t.href} className="grid gap-2 py-5 md:grid-cols-[12rem_1fr_1fr] md:gap-8">
              <Link href={t.href} className="font-serif text-xl font-semibold text-action underline-offset-4 hover:underline">
                {t.name}
              </Link>
              <p>{t.does}</p>
              <p className="text-ink-soft">
                <span className="sr-only">Limit: </span>
                {t.cannot}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="privacy-title" className="grid gap-8 md:grid-cols-3">
        <h2 id="privacy-title" className="sr-only">
          Privacy
        </h2>
        <div>
          <h3 className="font-serif text-xl font-semibold">Nothing is kept</h3>
          <p className="mt-2 text-ink-soft">Text and files are processed in memory and dropped when the check finishes. Nothing is logged.</p>
        </div>
        <div>
          <h3 className="font-serif text-xl font-semibold">You decide what leaves</h3>
          <p className="mt-2 text-ink-soft">
            Checks that search outside databases ask first and tell you which services will see which parts of your text.
          </p>
        </div>
        <div>
          <h3 className="font-serif text-xl font-semibold">Your model, your server</h3>
          <p className="mt-2 text-ink-soft">Rewriting uses whichever language model the operator configures, including a local one through Ollama.</p>
        </div>
      </section>
    </div>
  );
}
