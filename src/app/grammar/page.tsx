import type { Metadata } from "next";
import { GrammarTool } from "./tool";

export const metadata: Metadata = { title: "Grammar" };

export default function Page() {
  return <GrammarTool />;
}
