import type { Metadata } from "next";
import { RewriteTool } from "@/components/RewriteTool";

export const metadata: Metadata = { title: "Paraphraser" };

export default function Page() {
  return <RewriteTool kind="paraphrase" />;
}
