import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { DetectorTool } from "./tool";

export const metadata: Metadata = pageMetadata({
  title: "AI writing patterns",
  description:
    "See which paragraphs of a paper read as AI-written or AI-polished, with how sure the model is and the wording behind the score. Runs in your browser.",
  path: "/detector",
});

export default function Page() {
  return <DetectorTool />;
}
