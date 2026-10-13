import type { PlagiarismReport } from "@/core/plagiarism/types";
import { cx } from "../ui";

/** Each provider queried, how many of its searches worked, and how many documents it found. */
export function SearchedTable({ providers }: { providers: PlagiarismReport["providers"] }) {
  return (
    <details className="card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">
        What was searched
      </summary>
      <table className="mt-2 w-full text-left">
        <thead>
          <tr className="text-ink-faint">
            <th className="py-1 font-normal">Source</th>
            <th className="py-1 font-normal">Searches</th>
            <th className="py-1 font-normal">Found</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.name} className="border-t border-rule align-top">
              <td className="py-1 pr-2">
                {p.name}
                <span className="block text-ink-faint">
                  {p.coverage}
                </span>
              </td>
              <td
                className={cx(
                  "py-1 tabular-nums",
                  p.failures > 0 && "text-danger",
                )}
              >
                {p.kind === "library" || p.kind === "self"
                  ? "–"
                  : p.failures
                    ? `${p.queries - p.failures} of ${p.queries}`
                    : p.queries}
              </td>
              <td className="py-1 tabular-nums">{p.documents}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
