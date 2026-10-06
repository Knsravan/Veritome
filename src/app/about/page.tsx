import type { Metadata } from "next";
import { TOOLS } from "@/lib/tools";

export const metadata: Metadata = { title: "Limits and privacy" };

const GH = "https://github.com/Knsravan/Veritome/blob/main";

export default function Page() {
  return (
    <article className="max-w-3xl space-y-10">
      <header>
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Limits and privacy</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Veritome is built to help you review your own work. No tool here, and no commercial tool either, can tell you with certainty that a text
          is original or who wrote it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">How sure is each check?</h2>
        <dl className="divide-y divide-rule border-y border-rule">
          {TOOLS.map((t) => (
            <div key={t.href} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr]">
              <dt className="font-semibold">{t.name}</dt>
              <dd className="text-ink-soft">{t.cannot}</dd>
            </div>
          ))}
        </dl>
        <p>
          The AI-pattern check uses a model trained on about 90,000 labelled texts. On 3,775 texts it had never seen, it wrongly flagged 0.2% of
          human passages (none of the academic ones) and caught about half of the machine-written ones; paraphrased machine text is often rated
          inconclusive. The method, numbers and caveats are in{" "}
          <a className="text-action underline" href={`${GH}/docs/ACCURACY.md`}>
            docs/ACCURACY.md
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">What happens to your text</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Text and uploaded files are processed in memory and dropped when the request ends. Veritome does not store or log them.</li>
          <li>
            Plagiarism search, reference checks and source suggestions send short passages or reference entries to OpenAlex, Crossref, Semantic
            Scholar, arXiv, Europe PMC, Wikipedia, DataCite and (when the operator adds a key) CORE, and to Brave or Serper if web search is enabled. You are asked before this happens.
          </li>
          <li>Rewriting and the optional second opinion on writing patterns send text to the language model the operator configured.</li>
          <li>Grammar checks send text to a LanguageTool server only when the operator has connected one.</li>
          <li>Settings you choose are kept in your browser&rsquo;s local storage.</li>
        </ul>
        <p>For confidential manuscripts, run Veritome on your own machine with Docker and a local model. Instructions are in the README.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Using AI tools responsibly</h2>
        <p>
          Many journals and universities require authors to disclose substantive use of AI tools, and none accept a detector score as proof of
          misconduct on its own. If you use the humaniser or paraphraser, check your publisher&rsquo;s policy and disclose where it asks you to.
        </p>
      </section>
    </article>
  );
}
