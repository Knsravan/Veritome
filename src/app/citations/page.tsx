import type { Metadata } from "next";
import { CitationsTool } from "./tool";

export const metadata: Metadata = { title: "Citations" };

export default function Page() {
  return <CitationsTool />;
}
