import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { PlagiarismTool } from "./tool";

export const metadata: Metadata = pageMetadata({
  title: "Plagiarism check",
  description:
    "Check a paper for copied and reworded passages against open-access papers, abstracts, Wikipedia and your own documents, with AI-writing, citation and grammar checks in the same report.",
  path: "/plagiarism",
});

export default function Page() {
  return <PlagiarismTool />;
}
