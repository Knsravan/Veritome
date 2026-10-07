"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";

type Ask = (purpose: ConsentPurpose) => Promise<boolean>;
export type ConsentPurpose = "plagiarism" | "citations" | "report" | "grammar";

const ConsentContext = createContext<Ask | null>(null);

const WHAT_IS_SENT: Record<ConsentPurpose, string> = {
  plagiarism: "Short phrases and keywords from up to 40 parts of your text are sent as search queries.",
  citations: "Your reference entries, or the claim you selected, are sent as search queries.",
  report: "Short passages from your text, your reference entries and a few uncited claims are sent as search queries.",
  grammar: "Your whole text is sent to the public LanguageTool service (LanguageTool GmbH, Germany) for grammar and spelling checks.",
};

export function ConsentProvider({ children }: { children: ReactNode }) {
  const { settings, update, status } = useSettings();
  const [pending, setPending] = useState<{ purpose: ConsentPurpose; resolve: (ok: boolean) => void } | null>(null);
  const [remember, setRemember] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const ask = useCallback<Ask>(
    (purpose) => {
      if (settings.externalConsent === true) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setPending({ purpose, resolve }));
    },
    [settings.externalConsent],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (pending && !d.open) d.showModal?.();
    if (!pending && d.open) d.close();
  }, [pending]);

  const finish = (ok: boolean) => {
    if (ok && remember) update({ externalConsent: true });
    pending?.resolve(ok);
    setPending(null);
  };

  const services = [...new Set([...(status?.plagiarismSources ?? ["OpenAlex", "Crossref", "Semantic Scholar", "arXiv", "Europe PMC", "Wikipedia"]), "DataCite"])];
  const web = settings.webSearch ? (status?.webSearch ?? []) : [];

  return (
    <ConsentContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-md border border-rule bg-page p-0 text-ink shadow-2xl backdrop:bg-black/40"
      >
        {pending && (
          <div className="p-6">
            <h2 id={titleId} className="font-serif text-2xl font-semibold">
              Send parts of your text to search services?
            </h2>
            <p className="mt-3 text-ink-soft">{WHAT_IS_SENT[pending.purpose]}</p>
            <p className="mt-3 text-ink-soft">
              {pending.purpose === "grammar" ? (
                "LanguageTool says it does not store submitted text, but it is an outside service."
              ) : (
                <>
                  They go to {services.join(", ")}
                  {web.length ? `, and ${web.join(" and ")} for web search` : ""}. Each service has its own privacy policy and may keep
                  query logs.
                </>
              )}{" "}
              Veritome itself does not store or log your text.
            </p>
            <p className="mt-3 text-ink-soft">If your manuscript is confidential, cancel and use the offline checks instead.</p>
            <label className="mt-4 flex items-center gap-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--action)]" />
              Remember my answer on this device
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => finish(false)} className="rounded border border-rule px-4 py-2 font-medium hover:bg-desk">
                Cancel
              </button>
              <button type="button" onClick={() => finish(true)} className="rounded bg-action px-4 py-2 font-semibold text-action-ink hover:opacity-90">
                Send and run the check
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConsentContext.Provider>
  );
}

/** Resolves true when the user agrees to send text to external services. */
export function useConsent(): Ask {
  const ask = useContext(ConsentContext);
  if (!ask) throw new Error("useConsent must be used inside ConsentProvider");
  return ask;
}
