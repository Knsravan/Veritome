import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { CitationsTool } from "./tool";

export const metadata: Metadata = pageMetadata({
  title: "Citation checker",
  description:
    "Check every reference in a paper against Crossref, OpenAlex, DataCite and arXiv: wrong years, authors and DOIs, retracted papers and references that cannot be found. Export the corrected list or BibTeX.",
  path: "/citations",
});

export default function Page() {
  return <CitationsTool />;
}
