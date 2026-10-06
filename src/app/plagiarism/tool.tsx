"use client";

import { useState } from "react";
import { useConsent } from "@/components/Consent";
import { LibraryPicker, type LibraryItem } from "@/components/LibraryPicker";
import { PlagiarismResultView } from "@/components/PlagiarismResultView";
import { TextSource } from "@/components/TextSource";
import { Button, Checkbox, Notice, ToolHeader } from "@/components/ui";
import type { PlagiarismReport } from "@/core/plagiarism/types";
import { postJson } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { useRun } from "@/lib/useRun";

export function PlagiarismTool() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [external, setExternal] = useState(true);
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeReferences, setExcludeReferences] = useState(true);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const { settings, update, status } = useSettings();
  const consent = useConsent();
  const { result, error, busy, run } = useRun<PlagiarismReport>();
  const web = status?.webSearch ?? [];

  const go = async () => {
    if (external && !(await consent("plagiarism"))) return;
    await run(async (signal) => {
      const r = await postJson<PlagiarismReport>(
        "/api/plagiarism",
        { text, external, consent: external, web: settings.webSearch, excludeQuotes, excludeReferences, library },
        signal,
      );
      setChecked(text);
      return r;
    });
  };

  return (
    <div className="space-y-8">
      <ToolHeader
        title="Plagiarism check"
        intro="Looks for passages of your text that also appear, word for word, in published abstracts, on the web or in documents you add."
      />
      <div className="grid max-w-5xl gap-8 lg:grid-cols-[1fr_20rem]">
        <TextSource value={text} onChange={setText} />
        <div className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="font-semibold">What to compare against</legend>
            <Checkbox
              checked={external}
              onChange={setExternal}
              label="Scholarly databases"
              hint="OpenAlex, Crossref, Semantic Scholar and arXiv. Asks before sending anything."
            />
            <Checkbox
              checked={external && settings.webSearch && web.length > 0}
              onChange={(v) => update({ webSearch: v })}
              disabled={!external || web.length === 0}
              label="Web search"
              hint={web.length ? `Uses ${web.join(" and ")}.` : "Not enabled on this server."}
            />
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold">Leave out</legend>
            <Checkbox checked={excludeQuotes} onChange={setExcludeQuotes} label="Quotations" hint="Quoted passages of 40 characters or more." />
            <Checkbox checked={excludeReferences} onChange={setExcludeReferences} label="Reference list" />
          </fieldset>
          <LibraryPicker items={library} onChange={setLibrary} serverCount={status?.libraryDocuments ?? 0} />
        </div>
      </div>
      <div className="space-y-3">
        <Button onClick={() => void go()} busy={busy} disabled={!text.trim()}>
          {busy ? "Searching sources, this can take a minute" : "Check for overlap"}
        </Button>
        {!external && library.length === 0 && (status?.libraryDocuments ?? 0) === 0 && (
          <Notice kind="warn">With no sources selected, only repetition inside your own text is checked.</Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {result && checked && <PlagiarismResultView text={checked} report={result} />}
    </div>
  );
}
