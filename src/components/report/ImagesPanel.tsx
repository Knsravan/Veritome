"use client";

import type { ImageFinding, ImageReport } from "@/lib/images/analyze";
import { AlertIcon, CheckIcon } from "../icons";
import { Limits, Notice, cx } from "../ui";

const TITLE: Record<ImageFinding["kind"], string> = {
  duplicate: "The same picture is used twice",
  source_figure: "Matches a figure in a published source",
  text_match: "Text inside the picture matches a source",
};

function why(f: ImageFinding): { why: string; fix: string } {
  if (f.kind === "duplicate") {
    const turned = f.transform && f.transform !== "same";
    return turned
      ? {
          why: `One copy is ${f.transform}. Reusing a figure flipped or rotated, as if it showed something different, is treated by journals as image manipulation.`,
          fix: "Use each picture once. If both places need it, refer back to the first figure instead of repeating it.",
        }
      : {
          why: "The two pictures are the same, possibly resized or saved again. Repeated images in results are one of the first things integrity checks look for.",
          fix: "Use each picture once, or say clearly in the caption that it repeats an earlier figure.",
        };
  }
  if (f.kind === "source_figure")
    return {
      why: `Your picture looks the same as ${f.source?.figure.label ?? "a figure"} in “${f.source?.title}”${f.transform && f.transform !== "same" ? ` (yours is ${f.transform})` : ""}. Figures are covered by copyright and by plagiarism rules just like text.`,
      fix: "Credit the source in the caption (“Reproduced from …” or “Adapted from …”) and check that you have permission, or make your own figure.",
    };
  return {
    why: `${f.words} words of text inside this picture match ${f.sourceTitle ? `“${f.sourceTitle}”` : "a published source"}. Putting copied text in a picture does not hide it.`,
    fix: "Write the text yourself or quote and cite it, and credit the source of the picture.",
  };
}

/** Every picture in the paper, with what the image checks found. */
export function ImagesPanel({ report }: { report: ImageReport }) {
  const byId = new Map(report.images.map((i) => [i.id, i]));
  const flagged = new Set(report.findings.flatMap((f) => [f.imageId, f.otherId].filter(Boolean) as string[]));
  return (
    <div className="space-y-8">
      <section aria-labelledby="img-sum" className="card p-5 sm:p-6">
        <h3 id="img-sum" className="font-display text-2xl font-semibold">
          {report.findings.length === 0
            ? `No problems found in ${report.images.length} picture${report.images.length === 1 ? "" : "s"}`
            : `${report.findings.length} problem${report.findings.length === 1 ? "" : "s"} in ${report.images.length} picture${report.images.length === 1 ? "" : "s"}`}
        </h3>
        <ul className="mt-3 grid gap-2 text-sm text-ink-soft sm:grid-cols-3">
          <li className="flex items-start gap-2">
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-ok" /> Compared with each other, including flipped and rotated copies
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-ok" />
            {report.figuresCompared ? `Compared with ${report.figuresCompared} figures in the matched papers` : "No figures of matched papers were available to compare"}
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-ok" />
            {report.images.some((i) => i.text) ? `Text read from ${report.images.filter((i) => i.text).length} picture(s) and checked for copying` : "No readable text found inside the pictures"}
          </li>
        </ul>
      </section>

      {report.notes.map((n) => (
        <Notice key={n} kind="info">
          {n}
        </Notice>
      ))}

      {report.findings.length > 0 && (
        <section aria-labelledby="img-find" className="space-y-4">
          <h3 id="img-find" className="font-display text-xl font-semibold">
            What to fix
          </h3>
          {report.findings.map((f, n) => {
            const img = byId.get(f.imageId);
            const other = f.otherId ? byId.get(f.otherId) : undefined;
            const w = why(f);
            return (
              <article key={f.id} className="card animate-fade-up overflow-hidden" style={{ ["--i" as string]: n }}>
                <p className="flex items-center gap-2 border-b border-rule px-4 py-3 font-semibold text-danger">
                  <AlertIcon size={16} strokeWidth={2.2} /> {TITLE[f.kind]}
                </p>
                <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      img && { label: img.label, src: img.src },
                      other ? { label: other.label, src: other.src } : f.source ? { label: `${f.source.figure.label}, source`, src: f.source.thumb } : null,
                    ]
                      .filter(Boolean)
                      .map((x) => (
                        <figure key={x!.label} className="m-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={x!.src} alt={x!.label} className="aspect-square w-full rounded-md border border-rule bg-white object-contain" />
                          <figcaption className="mt-1 text-xs text-ink-faint">{x!.label}</figcaption>
                        </figure>
                      ))}
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="text-ink-soft">{w.why}</p>
                    <p>
                      <span className="font-semibold">How to fix: </span>
                      {w.fix}
                    </p>
                    {f.source?.url && (
                      <a href={f.source.url} target="_blank" rel="noreferrer" className="inline-block font-semibold text-action hover:underline">
                        Open the source
                      </a>
                    )}
                    {f.source?.figure.caption && <p className="text-xs text-ink-faint">Source caption: {f.source.figure.caption}</p>}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section aria-labelledby="img-all">
        <h3 id="img-all" className="font-display text-xl font-semibold">
          Every picture
        </h3>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {report.images.map((img, n) => (
            <li key={img.id} className="card animate-fade-up overflow-hidden" style={{ ["--i" as string]: n }}>
              {img.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.src} alt={img.label} className="aspect-[4/3] w-full bg-white object-contain" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-desk text-sm text-ink-faint">Cannot be shown</div>
              )}
              <div className="space-y-1 border-t border-rule px-3 py-2 text-sm">
                <p className="flex items-center justify-between gap-2 font-semibold">
                  {img.label}
                  <span className={cx("rounded-full px-2 py-px text-xs", flagged.has(img.id) ? "bg-danger-soft text-danger" : img.readable ? "bg-ok-soft text-ok" : "bg-desk-deep text-ink-faint")}>
                    {flagged.has(img.id) ? "Check" : img.readable ? "Looks fine" : "Not checked"}
                  </span>
                </p>
                {img.text && (
                  <details>
                    <summary className="cursor-pointer text-action">Text read from this picture</summary>
                    <p className="mt-1 max-h-32 overflow-y-auto font-serif text-xs whitespace-pre-wrap text-ink-soft">{img.text}</p>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Limits>
        <p>
          Veritome compares your pictures with each other and with the figures of matched open-access papers and Wikipedia articles. It cannot search
          the whole web for a picture (a reverse image search), so a picture copied from elsewhere can still be missed.
        </p>
        <p>Pictures are checked in your browser; only the text read from them is sent for the plagiarism search.</p>
      </Limits>
    </div>
  );
}
