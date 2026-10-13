import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { HumaniserTool } from "./tool";

export const metadata: Metadata = pageMetadata({
  title: "Humaniser",
  description:
    "Revise stiff, formulaic prose paragraph by paragraph in your own voice, with citations, numbers and maths locked and the meaning checked.",
  path: "/humaniser",
});

export default function Page() {
  return <HumaniserTool />;
}
