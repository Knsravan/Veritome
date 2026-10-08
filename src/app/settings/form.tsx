"use client";

import { useEffect, useState } from "react";
import { Button, Checkbox, Notice, ToolHeader } from "@/components/ui";
import { ThemeChoice } from "@/components/ThemeToggle";
import { useSettings } from "@/lib/settings";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SettingsForm() {
  const { settings, update, status } = useSettings();
  const [llm, setLlm] = useState(settings.llm);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLlm(settings.llm), [settings.llm]);

  return (
    <div className="max-w-3xl space-y-10">
      <ToolHeader title="Settings" intro="Choices here are saved in this browser only." />

      <section aria-labelledby="look-h" className="space-y-3">
        <h2 id="look-h" className="font-display text-2xl font-semibold">
          Appearance
        </h2>
        <p className="text-ink-soft">Light, dark, or whatever your device is set to.</p>
        <ThemeChoice />
      </section>

      <section aria-labelledby="srv-h">
        <h2 id="srv-h" className="font-display text-2xl font-semibold">
          This server
        </h2>
        {status ? (
          <dl className="mt-2 divide-y divide-rule">
            <Row label="Language model" value={status.llm ? `Configured${status.llmModel ? ` (${status.llmModel})` : ""}` : "Not configured"} />
            <Row label="LanguageTool" value={status.languageTool ? "Connected" : "Not connected"} />
            <Row label="Web search" value={status.webSearch.length ? status.webSearch.join(", ") : "Not enabled"} />
            <Row label="OpenAlex key" value={status.openAlexKey ? "Set (larger daily search allowance)" : "Not set"} />
            <Row label="Semantic Scholar key" value={status.semanticScholarKey ? "Set (abstract and full-text snippet search enabled)" : "Not set (Semantic Scholar is not searched)"} />
            <Row label="Shared document library" value={`${status.libraryDocuments} document${status.libraryDocuments === 1 ? "" : "s"}`} />
          </dl>
        ) : (
          <p className="mt-2 text-ink-soft">Loading server status…</p>
        )}
      </section>

      <section aria-labelledby="priv-h" className="space-y-3">
        <h2 id="priv-h" className="font-display text-2xl font-semibold">
          Outside services
        </h2>
        <p className="text-ink-soft">
          {settings.externalConsent
            ? "You have agreed to send parts of your text to scholarly search services without being asked each time."
            : "You will be asked each time a check needs to send text to an outside service."}
        </p>
        {settings.externalConsent && (
          <Button variant="secondary" onClick={() => update({ externalConsent: null })}>
            Ask me every time
          </Button>
        )}
        <Checkbox
          checked={settings.webSearch}
          onChange={(v) => update({ webSearch: v })}
          label="Include web search in plagiarism checks when the server offers it"
          hint="Web search sends short phrases from your text to Brave or Serper (Google)."
        />
      </section>

      <section aria-labelledby="llm-h" className="space-y-3">
        <h2 id="llm-h" className="font-display text-2xl font-semibold">
          Your own language model
        </h2>
        {!status?.allowClientLlm ? (
          <p className="text-ink-soft">
            This server only uses the model its operator configured. To use your own, run Veritome yourself and set ALLOW_CLIENT_LLM=true, or set
            LLM_BASE_URL and LLM_MODEL.
          </p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              update({ llm });
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            }}
          >
            <p className="text-ink-soft">Any OpenAI-compatible endpoint, for example http://localhost:11434/v1 for Ollama.</p>
            {(
              [
                ["baseUrl", "Base URL", "url", "https://api.openai.com/v1"],
                ["model", "Model name", "text", "llama3.1:8b"],
                ["apiKey", "API key (optional)", "password", ""],
              ] as const
            ).map(([k, label, type, ph]) => (
              <label key={k} className="block">
                <span className="font-semibold">{label}</span>
                <input
                  type={type}
                  value={llm[k]}
                  placeholder={ph}
                  autoComplete="off"
                  onChange={(e) => setLlm({ ...llm, [k]: e.target.value })}
                  className="mt-1 block w-full rounded border border-rule bg-page px-3 py-2"
                />
              </label>
            ))}
            <Notice kind="warn">The key is stored in this browser&rsquo;s local storage and sent to this server with each rewrite request. Use a key you can revoke.</Notice>
            <div className="flex items-center gap-3">
              <Button type="submit">Save model settings</Button>
              <Button variant="secondary" onClick={() => update({ llm: { baseUrl: "", model: "", apiKey: "" } })}>
                Remove
              </Button>
              <span role="status" className="text-sm text-ok">
                {saved ? "Saved" : ""}
              </span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
