import Link from "next/link";
import type { ReactNode } from "react";
import {
  CompareIcon,
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  PenIcon,
  RepeatIcon,
  ScanIcon,
  ShieldIcon,
  TypeIcon,
  UploadIcon,
} from "@/components/icons";
import { CountUp, Reveal } from "@/components/motion";
import { TOOLS } from "@/lib/tools";

const TOOL_ICON: Record<string, ReactNode> = {
  "/plagiarism": <CopyIcon size={20} />,
  "/detector": <ScanIcon size={20} />,
  "/humaniser": <PenIcon size={20} />,
  "/paraphraser": <RepeatIcon size={20} />,
  "/citations": <BookIcon size={20} />,
  "/grammar": <TypeIcon size={20} />,
  "/compare": <CompareIcon size={20} />,
};

const SOURCES = [
  "OpenAlex",
  "Crossref",
  "Europe PMC",
  "arXiv",
  "Semantic Scholar",
  "CORE",
  "Wikipedia",
  "The open web",
];

/** The hero's example report: scores count up, bars grow and the findings draw across the text one by one. */
function ExampleReport() {
  return (
    <figure aria-label="Example of a Veritome report" className="relative">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(closest-side,var(--glow),transparent)] blur-2xl"
      />
      <div className="card overflow-hidden shadow-[var(--shadow-lift)]">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-rule" />
              <span className="size-2.5 rounded-full bg-rule" />
              <span className="size-2.5 rounded-full bg-rule" />
            </span>
            <p className="ml-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
              Example report
            </p>
          </div>
          <p className="text-xs text-ink-faint">4,812 words</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
          {[
            {
              label: "Similarity",
              value: 14,
              unit: "%",
              note: "3 sources",
              w: 14,
              color: "var(--status-critical)",
            },
            {
              label: "AI writing",
              value: 8,
              unit: "%",
              note: "1 paragraph",
              w: 8,
              color: "var(--chart-ai)",
            },
            {
              label: "References",
              value: 23,
              unit: "/24",
              note: "1 to check",
              w: 96,
              color: "var(--ok)",
            },
          ].map((s, i) => (
            <div key={s.label} className="px-4 py-4">
              <p className="text-xs font-medium text-ink-soft">{s.label}</p>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight">
                <CountUp value={s.value} />
                <span className="text-sm font-medium text-ink-faint">
                  {s.unit}
                </span>
              </p>
              <span
                aria-hidden
                className="mt-2 block h-1.5 overflow-hidden rounded-full bg-desk-deep"
              >
                <span
                  className="animate-grow-x block h-full rounded-full"
                  style={{
                    width: `${s.w}%`,
                    background: s.color,
                    ["--i" as string]: i,
                  }}
                />
              </span>
              <p className="mt-1.5 text-xs text-ink-faint">{s.note}</p>
            </div>
          ))}
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="sheet-text text-[0.98rem]">
            Late-season respiration stayed high in alder stands near the river.{" "}
            <span
              className="draw-mark rounded-sm"
              style={{
                ["--i" as string]: 0,
                ["--draw-color" as string]: "var(--u-src-1)",
              }}
            >
              Riparian zones account for a large share of soil carbon efflux in
              temperate catchments
            </span>{" "}
            <span
              className="draw-mark rounded-sm"
              style={{
                ["--i" as string]: 1,
                ["--draw-color" as string]: "var(--u-cite)",
              }}
            >
              (Smith &amp; Lee, 2021)
            </span>
            .{" "}
            <span
              className="draw-mark rounded-sm"
              style={{
                ["--i" as string]: 2,
                ["--draw-color" as string]: "var(--u-ai)",
              }}
            >
              Moreover, it is important to note that this plays a pivotal role
            </span>{" "}
            in regional budgets. The{" "}
            <span
              className="draw-mark rounded-sm"
              style={{
                ["--i" as string]: 3,
                ["--draw-color" as string]: "var(--u-grammar)",
              }}
            >
              the
            </span>{" "}
            litter-bag data were meant to close the gap.
          </p>
        </div>
        <figcaption className="grid gap-px border-t border-rule bg-rule text-sm sm:grid-cols-2">
          {[
            [
              "var(--status-critical)",
              "Copied, not cited",
              "14 words match source 1.",
            ],
            [
              "var(--mark-cite)",
              "Year mismatch",
              "Your reference list says 2020.",
            ],
            [
              "var(--chart-ai)",
              "Reads as AI-written",
              "With how sure the model is.",
            ],
            ["var(--mark-grammar)", "Repeated word", "With a one-click fix."],
          ].map(([c, t, d], i) => (
            <p
              key={t}
              className="animate-fade-up flex items-start gap-2 bg-page px-4 py-2.5"
              style={{ ["--i" as string]: i + 6 }}
            >
              <span
                aria-hidden
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ background: c }}
              />
              <span>
                <span className="font-semibold">{t}.</span>{" "}
                <span className="text-ink-soft">{d}</span>
              </span>
            </p>
          ))}
        </figcaption>
      </div>
    </figure>
  );
}

const STEPS = [
  {
    icon: <UploadIcon size={20} />,
    title: "Upload your paper",
    text: "Word, PDF, LaTeX or plain text. Or paste it.",
  },
  {
    icon: <FileIcon size={20} />,
    title: "We check every part",
    text: "Against hundreds of millions of papers and the open web, your references against the databases they cite, your writing against trained models.",
  },
  {
    icon: <CheckIcon size={20} />,
    title: "Fix what matters",
    text: "Every mistake marked in your text, ranked by how serious it is, with how to fix it and a PDF to keep.",
  },
];

const REPORT_FEATURES = [
  {
    title: "Similarity and AI writing, side by side",
    text: "Two clear scores, each broken down so you know what kind of problem it is.",
  },
  {
    title: "Every mistake explained",
    text: "Copied without a citation, missing quotation marks, reworded, quoted without a source: each says why it matters and how to fix it.",
  },
  {
    title: "Your words next to the source's",
    text: "Click any highlight to compare it with the original passage and open the paper.",
  },
  {
    title: "Charts and a PDF to keep",
    text: "See where problems sit in your document and download a complete report.",
  },
];

export default function Home() {
  return (
    <div className="space-y-28 pb-8">
      <section className="relative grid items-center gap-14 pt-6 lg:grid-cols-[1fr_1.05fr] lg:pt-10">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute top-[-7rem] left-1/2 -z-10 h-[46rem] w-screen -translate-x-1/2"
        />
        <div>
          <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-rule bg-page/80 px-3 py-1 text-sm font-medium text-ink-soft shadow-sm backdrop-blur">
            <span
              className="animate-pulse-ring size-2 rounded-full bg-ok"
              aria-hidden
            />{" "}
            Free, open source, nothing stored
          </p>
          <h1
            className="animate-fade-up mt-6 font-display text-[2.6rem] leading-[1.04] font-bold tracking-[-0.035em] sm:text-[3.9rem]"
            style={{ ["--i" as string]: 1 }}
          >
            Check your paper before{" "}
            <span className="relative whitespace-nowrap text-action">
              reviewers
              <svg
                aria-hidden
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                className="absolute -bottom-1 left-0 h-3 w-full"
              >
                <path
                  d="M2 9 C 50 2, 150 2, 198 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength={1}
                  className="draw-line"
                />
              </svg>
            </span>{" "}
            do.
          </h1>
          <p
            className="animate-fade-up mt-6 max-w-xl text-lg leading-relaxed text-ink-soft"
            style={{ ["--i" as string]: 2 }}
          >
            One upload checks for copied and reworded passages, AI-written
            paragraphs, broken or retracted references and grammar slips. Every
            finding is marked in your text, with how to fix it and an honest
            note on how sure it is.
          </p>
          <div
            className="animate-fade-up mt-9 flex flex-wrap gap-3"
            style={{ ["--i" as string]: 3 }}
          >
            <Link
              href="/plagiarism"
              className="group inline-flex h-12 items-center gap-2 rounded-xl bg-action px-6 font-semibold text-action-ink shadow-[0_10px_24px_-10px_var(--action)] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
            >
              Check your paper{" "}
              <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/plagiarism?sample=1"
              className="inline-flex h-12 items-center rounded-xl border border-rule bg-page px-6 font-semibold shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              Try it with a sample
            </Link>
          </div>
          <ul
            className="animate-fade-up mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft"
            style={{ ["--i" as string]: 4 }}
          >
            {["No account needed", "Nothing stored", "Results in minutes"].map(
              (t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-ok-soft text-ok">
                    <CheckIcon size={13} strokeWidth={2.6} />
                  </span>
                  {t}
                </li>
              ),
            )}
          </ul>
        </div>
        <div className="animate-fade-up" style={{ ["--i" as string]: 2 }}>
          <ExampleReport />
        </div>
      </section>

      <Reveal
        as="section"
        aria-label="What Veritome searches"
        className="text-center"
      >
        <p className="text-sm font-semibold tracking-wide text-ink-faint uppercase">
          Checks your text against
        </p>
        <ul className="mx-auto mt-5 flex max-w-4xl flex-wrap justify-center gap-2.5">
          {SOURCES.map((s, i) => (
            <li
              key={s}
              className="animate-fade-up rounded-full border border-rule bg-page px-4 py-1.5 text-sm font-medium text-ink-soft shadow-sm"
              style={{ ["--i" as string]: i }}
            >
              {s}
            </li>
          ))}
        </ul>
      </Reveal>

      <section aria-labelledby="how-title">
        <Reveal>
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            How it works
          </p>
          <h2
            id="how-title"
            className="mt-2 max-w-2xl font-display text-3xl font-bold sm:text-4xl"
          >
            Three steps from draft to a report you can act on
          </h2>
        </Reveal>
        <ol className="relative mt-10 grid gap-5 md:grid-cols-3">
          <span
            aria-hidden
            className="absolute top-11 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-rule to-transparent md:block"
          />
          {STEPS.map((s, i) => (
            <Reveal
              as="li"
              key={s.title}
              index={i}
              className="card card-hover relative p-6"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-action-soft text-action ring-4 ring-page">
                  {s.icon}
                </span>
                <span className="text-sm font-semibold text-ink-faint">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-ink-soft">{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="report-title"
        className="grid items-start gap-10 lg:grid-cols-[1fr_1.2fr]"
      >
        <Reveal>
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            The report
          </p>
          <h2
            id="report-title"
            className="mt-2 font-display text-3xl font-bold sm:text-4xl"
          >
            Tells you what is wrong, where, and how to fix it
          </h2>
          <p className="mt-4 text-lg text-ink-soft">
            Not just a percentage. Every finding is sorted by how serious it is,
            shown in your text and explained in plain words.
          </p>
          <Link
            href="/plagiarism?sample=1"
            className="group mt-6 inline-flex items-center gap-1.5 font-semibold text-action"
          >
            See a sample report{" "}
            <ArrowRightIcon
              size={16}
              className="transition-transform group-hover:translate-x-1"
            />
          </Link>
        </Reveal>
        <ul className="grid gap-4 sm:grid-cols-2">
          {REPORT_FEATURES.map((f, i) => (
            <Reveal
              as="li"
              key={f.title}
              index={i}
              className="card card-hover p-5"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-ok-soft text-ok">
                {i === 3 ? (
                  <DownloadIcon size={16} />
                ) : (
                  <CheckIcon size={16} strokeWidth={2.4} />
                )}
              </span>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{f.text}</p>
            </Reveal>
          ))}
        </ul>
      </section>

      <section
        id="tools"
        aria-labelledby="tools-title"
        className="scroll-mt-24"
      >
        <Reveal>
          <p className="text-sm font-semibold tracking-wide text-action uppercase">
            Tools
          </p>
          <h2
            id="tools-title"
            className="mt-2 font-display text-3xl font-bold sm:text-4xl"
          >
            Two tools ready, five on the way
          </h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-soft">
            Use them together in one report, or one at a time. No checker is
            right every time, commercial ones included, so each tool tells you
            what it cannot see.
          </p>
        </Reveal>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t, i) => (
            <Reveal
              as="li"
              key={t.href}
              index={i % 3}
              className="card card-hover group relative flex flex-col p-6"
            >
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-action-soft text-action transition-transform duration-300 group-hover:scale-110">
                {TOOL_ICON[t.href]}
              </span>
              {t.soon && (
                <span className="absolute top-5 right-5 rounded-full bg-desk-deep px-2.5 py-0.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  Coming soon
                </span>
              )}
              <h3 className="mt-5 text-lg font-semibold">
                <Link
                  href={t.href}
                  className="after:absolute after:inset-0 after:rounded-[1rem] focus-visible:outline-none group-focus-within:underline"
                >
                  {t.name}
                </Link>
              </h3>
              <p className="mt-2 text-ink-soft">{t.does}</p>
              <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-soft">
                <span className="font-semibold text-ink">Limit: </span>
                {t.cannot}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-semibold text-action">
                {t.soon ? "See what is coming" : `Open ${t.name}`}{" "}
                <ArrowRightIcon
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </span>
            </Reveal>
          ))}
        </ul>
      </section>

      <Reveal
        as="section"
        aria-labelledby="privacy-title"
        className="overflow-hidden rounded-[1.75rem] bg-ink text-page shadow-[var(--shadow-lift)]"
      >
        <div className="grid gap-10 p-8 sm:p-12 md:grid-cols-[1fr_1.4fr] md:items-center">
          <div>
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-page/10 text-page">
              <ShieldIcon size={24} />
            </span>
            <h2
              id="privacy-title"
              className="mt-5 font-display text-3xl font-bold"
            >
              Your paper stays yours
            </h2>
            <p className="mt-3 text-page/75">
              Unpublished work is sensitive. Veritome is built so that nothing
              about it is kept.
            </p>
          </div>
          <ul className="grid gap-6 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
            {[
              [
                "Nothing is kept",
                "Text and files are processed in memory and dropped when the check finishes. Nothing is logged.",
              ],
              [
                "You decide what leaves",
                "Checks that search outside databases ask first and say which services see which parts.",
              ],
              [
                "Run it yourself",
                "Confidential manuscript? Run Veritome on your own computer with Docker and a local model.",
              ],
            ].map(([t, d]) => (
              <li key={t}>
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-page/70">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      <Reveal as="section" aria-labelledby="cta-title" className="text-center">
        <h2
          id="cta-title"
          className="font-display text-3xl font-bold sm:text-4xl"
        >
          Ready to check your paper?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-ink-soft">
          It takes a minute or two, and your text is never stored.
        </p>
        <Link
          href="/plagiarism"
          className="group mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-action px-7 font-semibold text-action-ink shadow-[0_10px_24px_-10px_var(--action)] transition-transform duration-200 hover:-translate-y-0.5"
        >
          Check your paper{" "}
          <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-1" />
        </Link>
      </Reveal>
    </div>
  );
}
