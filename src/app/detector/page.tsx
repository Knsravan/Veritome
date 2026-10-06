import type { Metadata } from "next";
import { DetectorTool } from "./tool";

export const metadata: Metadata = { title: "AI writing patterns" };

export default function Page() {
  return <DetectorTool />;
}
