"use client";

import { useState } from "react";
import { StylePicker, VerifyView, WorkCitation } from "@/components/CitationViews";
import { useConsent } from "@/components/Consent";
import { BookIcon, ScanIcon } from "@/components/icons";
import { SlidingChoice } from "@/components/motion-ui";
import { TextSource } from "@/components/TextSource";
import { Button, Limits, Notice, Warnings } from "@/components/ui";
import type { ClaimCandidate, SuggestResult } from "@/core/citations/finder";
import type { CitationCrossCheck } from "@/core/citations/intext";
import type { CitationStyle } from "@/core/citations/types";
import type { VerifyListResult } from "@/core/citations/verify";
import { ApiError, postJson } from "@/lib/api";
import { SAMPLE_REFERENCES } from "@/lib/sample";
import { useRun } from "@/lib/useRun";

type VerifyReply = VerifyListResult & { crossCheck: CitationCrossCheck | null };

function CheckReferences() {
  const [text, setText] = useState("");
  const consent = useConsent();
  const { result, error, busy, run } = useRun<VerifyReply>();
  const go = async () => {
    if (!(await consent("citations"))) return;
    const refsOnly = !/^\s*(references|bibliography|works cited)\s*$/im.test(text);
    await run((signal) => postJson<VerifyReply>("/api/citations/verify", refsOnly ? { references: text, consent: true } : { text, consent: true }, signal));
  };
  return (
    <div className="space-y-6">
      <div className="card animate-fade-up space-y-4 p-4 sm:p-6" style={{ ["--i" as string]: 4 }}>
        <TextSource
          value={text}
          onChange={setText}
          label="Reference list, or the whole paper"
          sample={SAMPLE_REFERENCES}
          hint="Paste just the references, or upload or paste the whole paper with a “References” heading to also check the citations in the text against the list."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void go()} busy={busy} disabled={!text.trim()}>
            {busy ? "Looking up references" : "Check references"}
          </Button>
          {busy && <span className="text-sm text-ink-faint" role="status">Each entry is looked up in turn; a long list can take a minute or two.</span>}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {result && (
        <div className="animate-fade-up">
          <VerifyView result={result} crossCheck={result.crossCheck} />
        </div>
      )}
      <Limits>
        <p>
          Entries are looked up by DOI, then by title, in Crossref, OpenAlex, DataCite and arXiv. “Not found” does not mean made up: books, reports,
          theses and very new papers are often missing. Retraction notices come from database metadata and can lag behind the publisher.
        </p>
      </Limits>
    </div>
  );
}

function FindSources() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<CitationStyle>("apa");
  const [claims, setClaims] = useState<ClaimCandidate[] | null>(null);
  const [found, setFound] = useState<Record<number, SuggestResult | "busy" | { error: string }>>({});
  const [single, setSingle] = useState("");
  const consent = useConsent();
  const scan = useRun<{ claims: ClaimCandidate[] }>();

  const scanText = () =>
    scan.run(async (signal) => {
      const r = await postJson<{ claims: ClaimCandidate[] }>("/api/citations/find", { text }, signal);
      setClaims(r.claims);
      setFound({});
      return r;
    });

  const search = async (key: number, claim: string) => {
    if (!(await consent("citations"))) return;
    setFound((f) => ({ ...f, [key]: "busy" }));
    try {
      const r = await postJson<SuggestResult>("/api/citations/find", { claim, consent: true });
      setFound((f) => ({ ...f, [key]: r }));
    } catch (err) {
      setFound((f) => ({ ...f, [key]: { error: err instanceof ApiError ? err.message : "The search failed." } }));
    }
  };

  const Results = ({ k }: { k: number }) => {
    const r = found[k];
    if (!r) return null;
    if (r === "busy") return <p className="mt-2 text-sm text-ink-faint" role="status">Searching OpenAlex, Semantic Scholar, Crossref and arXiv…</p>;
    if ("error" in r) return <Notice kind="error">{r.error}</Notice>;
    return (
      <div className="mt-3 space-y-3">
        <Warnings items={r.warnings} />
        {r.suggestions.length > 0 && (
          <ol className="space-y-3">
            {r.suggestions.map((s) => (
              <li key={s.work.doi ?? s.work.title} className="border-l-4 border-cite pl-3">
                <WorkCitation work={s.work} style={style} />
                <p className="mt-1 text-sm text-ink-faint">
                  Word overlap {Math.round(s.relevance * 100)} out of 100. {s.reason}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card animate-fade-up space-y-4 p-4 sm:p-6" style={{ ["--i" as string]: 4 }}>
          <TextSource value={text} onChange={setText} label="Scan a text for uncited claims" rows={10} hint="Finding the claims happens on the server without any outside service." />
          <Button onClick={() => void scanText()} busy={scan.busy} disabled={!text.trim()}>
            Find claims that may need a citation
          </Button>
          {scan.error && <Notice kind="error">{scan.error}</Notice>}
        </div>
        <div className="card animate-fade-up space-y-3 p-4 sm:p-6" style={{ ["--i" as string]: 5 }}>
          <label htmlFor="claim" className="font-semibold">
            Or search for one statement
          </label>
          <textarea
            id="claim"
            rows={4}
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            maxLength={2000}
            className="sheet-text neu-in block w-full max-w-none rounded-xl border border-[var(--neu-edge)] px-4 py-3"
            placeholder="e.g. Riparian zones account for a large share of soil carbon efflux in temperate catchments."
          />
          <Button variant="secondary" disabled={!single.trim() || found[-1] === "busy"} onClick={() => void search(-1, single)}>
            Find papers
          </Button>
          <Results k={-1} />
        </div>
      </div>
      {claims && (
        <section aria-labelledby="claims-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="claims-h" className="font-display text-2xl font-semibold">
              {claims.length === 0 ? "No uncited claims found" : `${claims.length} sentence${claims.length === 1 ? "" : "s"} that may need a citation`}
            </h2>
            <StylePicker value={style} onChange={setStyle} />
          </div>
          <ol className="space-y-3">
            {claims.map((c, i) => (
              <li key={c.start} className="card px-4 py-3">
                <p className="font-serif">
                  <span className="mark mark-cite">{c.text}</span>
                </p>
                <p className="mt-1 text-sm text-ink-soft">Why: {c.reasons.join("; ")}.</p>
                <Button variant="quiet" className="mt-1 px-0" disabled={found[i] === "busy"} onClick={() => void search(i, c.text)}>
                  Find papers for this claim
                </Button>
                <Results k={i} />
              </li>
            ))}
          </ol>
        </section>
      )}
      <Limits>
        <p>
          Suggestions are search results ranked by word overlap with your sentence. A paper on the same topic may not support your claim, or may
          contradict it. Read it before you cite it.
        </p>
      </Limits>
    </div>
  );
}

export function CitationsTool() {
  const [tab, setTab] = useState<"check" | "find">("check");
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="animate-fade-up text-sm font-semibold tracking-wide text-action uppercase">Citations</p>
        <h1
          className="animate-fade-up mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]"
          style={{ ["--i" as string]: 1 }}
        >
          Make sure every reference is real and right
        </h1>
        <p className="animate-fade-up mt-3 text-lg text-ink-soft" style={{ ["--i" as string]: 2 }}>
          Each reference is looked up in Crossref, OpenAlex, DataCite and arXiv. You see which ones match a real record, which
          have a wrong year, author or DOI, which were retracted, and which could not be found. You can also find published
          papers for claims that have no citation.
        </p>
        <div className="animate-fade-up mt-6" style={{ ["--i" as string]: 3 }}>
          <SlidingChoice
            label="Citation tools"
            value={tab}
            onChange={setTab}
            options={[
              { id: "check", title: "Check a reference list", label: <><BookIcon size={16} /> Check references</> },
              { id: "find", title: "Find papers for claims without a citation", label: <><ScanIcon size={16} /> Find sources</> },
            ]}
          />
        </div>
      </header>
      <div role="tabpanel" aria-label={tab === "check" ? "Check references" : "Find sources"}>
        {tab === "check" ? <CheckReferences /> : <FindSources />}
      </div>
    </div>
  );
}
