import type { Metadata } from "next";
import { CompareTool } from "./tool";

export const metadata: Metadata = { title: "Compare papers" };

export default function Page() {
  return <CompareTool />;
}
