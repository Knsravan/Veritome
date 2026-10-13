import type { Metadata } from "next";
import Home from "@/app/page";
import { checkPlagiarism } from "@/core/plagiarism/check";
import { SAMPLE_PAPER } from "@/lib/sample";
import { GlassPreview } from "./preview";

export const metadata: Metadata = {
  title: "Glass preview",
  description: "A preview of Veritome with a glassmorphism look.",
  robots: { index: false, follow: false },
};

// A sentence of the sample paper, as if it had been published before, so the sample report has a finding to show.
const COPIED = "the alder stands near the river kept respiring at almost the summer rate well into October";

export default async function GlassPreviewPage() {
  const report = await checkPlagiarism(SAMPLE_PAPER, {
    library: [{ id: "sample", title: "An earlier draft (sample source)", text: `Two did not: ${COPIED}.` }],
  });
  return (
    <GlassPreview text={SAMPLE_PAPER} report={report}>
      <Home />
    </GlassPreview>
  );
}
