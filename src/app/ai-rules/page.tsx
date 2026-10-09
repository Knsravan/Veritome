import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { HUMANISE_DISCLOSURE } from "@/core/rewrite/humanise";
import {
  AI_RULES_CHECKED,
  ETHICS_RULES,
  PUBLISHER_RULES,
  TURNITIN_FACTS,
  UNIVERSITIES,
  type PublisherRule,
} from "@/lib/ai-rules";

export const metadata: Metadata = {
  title: "AI rules for authors",
  description:
    "What journals, publishers and universities allow authors to do with AI writing tools, and how to disclose it.",
};

function RuleCard({ r }: { r: PublisherRule }) {
  return (
    <article className="card space-y-3 p-5">
      <h3 className="font-display text-lg font-semibold">{r.name}</h3>
      <dl className="space-y-2 text-sm">
        {(
          [
            ["AI as an author", r.author],
            ["Help with writing", r.editing],
            ["Disclose it", r.disclose],
            ["Images", r.images],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="font-semibold">{k}</dt>
            <dd className="text-ink-soft">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-faint">
        <a href={r.url} className="text-action underline" target="_blank" rel="noreferrer">
          Read the policy
        </a>
        {r.updated && ` · updated ${r.updated}`}
      </p>
    </article>
  );
}

export default function Page() {
  return (
    <article className="max-w-5xl space-y-12">
      <header className="animate-fade-up max-w-3xl">
        <p className="text-sm font-semibold tracking-wide text-action uppercase">Guide</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">AI rules for authors</h1>
        <p className="mt-3 text-lg text-ink-soft">
          What journals, publishers and universities allow you to do with AI writing tools, and how to say you used them. In short: AI can help
          with your writing, it can never be an author, and you should say how you used it.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          Checked against each organisation&apos;s own policy on {AI_RULES_CHECKED}. Policies change and single journals can be stricter, so
          always read your target journal&apos;s instructions for authors.
        </p>
      </header>

      <Reveal as="section" index={1} className="space-y-3">
        <h2 className="font-display text-2xl font-semibold">What almost everyone agrees on</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            ["AI can never be an author.", "It cannot take responsibility for the work, so every publisher and ethics body here that addresses it rules it out."],
            ["Help with language is allowed.", "Grammar, spelling, readability and translation help is accepted almost everywhere."],
            ["Say how you used it.", "Most ask for a short statement; where it goes differs (Methods, Acknowledgments, a separate declaration)."],
            ["You answer for every word.", "Check what the tool wrote: facts, numbers, citations and meaning stay your responsibility."],
          ].map(([t, d]) => (
            <li key={t} className="card p-4">
              <p className="font-semibold">{t}</p>
              <p className="text-sm text-ink-soft">{d}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-soft">
          Research images are the strictest area: AI-made or AI-altered microscopy, blots, scans and photos are banned or need permission almost
          everywhere.
        </p>
      </Reveal>

      <Reveal as="section" index={2} className="space-y-4">
        <h2 className="font-display text-2xl font-semibold">Publishers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {PUBLISHER_RULES.map((r) => (
            <RuleCard key={r.name} r={r} />
          ))}
        </div>
      </Reveal>

      <Reveal as="section" index={3} className="space-y-4">
        <h2 className="font-display text-2xl font-semibold">Ethics bodies and style guides</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {ETHICS_RULES.map((r) => (
            <RuleCard key={r.name} r={r} />
          ))}
        </div>
      </Reveal>

      <Reveal as="section" index={4} className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-2xl font-semibold">Universities and AI scores</h2>
          <p className="text-ink-soft">{UNIVERSITIES.summary}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {UNIVERSITIES.examples.map((u) => (
              <li key={u.name}>
                <a href={u.url} className="text-action underline" target="_blank" rel="noreferrer">
                  {u.name}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">Your own university&apos;s academic integrity policy is the rule that applies to you.</p>
        </div>
        <div className="space-y-3">
          <h2 className="font-display text-2xl font-semibold">What Turnitin says about its AI score</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
            {TURNITIN_FACTS.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs">
            <a href={TURNITIN_FACTS.url} className="text-action underline" target="_blank" rel="noreferrer">
              Turnitin&apos;s AI writing FAQ
            </a>
          </p>
        </div>
      </Reveal>

      <Reveal as="section" index={5} className="card space-y-3 p-5 sm:p-6">
        <h2 className="font-display text-2xl font-semibold">How to disclose it</h2>
        <p className="text-ink-soft">
          Put a short, plain statement where your journal asks for it (often the Acknowledgments or a separate declaration). Name the tool and say
          what it did. For example:
        </p>
        <blockquote className="rounded-lg border-l-4 border-action bg-action-soft px-4 py-3 font-serif">{HUMANISE_DISCLOSURE}</blockquote>
        <p className="text-sm text-ink-soft">
          If the journal wants more detail, add the tool&apos;s name and version, which sections it touched, and that you checked the result. In
          APA style, cite the tool&apos;s maker as the author, for example: OpenAI. (2023). <i>ChatGPT</i> (Mar 14 version) [Large language model].
        </p>
        <p className="text-sm">
          <Link href="/humaniser" className="font-semibold text-action underline">
            Back to the Humaniser
          </Link>
        </p>
      </Reveal>
    </article>
  );
}
