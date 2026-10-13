import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { ParaphraserTool } from "./tool";

export const metadata: Metadata = pageMetadata({
  title: "Paraphraser",
  description:
    "Reword academic text in seven styles at the strength you choose, with citations, numbers and locked words kept exact and the meaning checked.",
  path: "/paraphraser",
});

export default function Page() {
  return <ParaphraserTool />;
}
