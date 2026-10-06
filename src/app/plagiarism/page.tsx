import type { Metadata } from "next";
import { PlagiarismTool } from "./tool";

export const metadata: Metadata = { title: "Plagiarism check" };

export default function Page() {
  return <PlagiarismTool />;
}
