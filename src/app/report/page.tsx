import type { Metadata } from "next";
import { ReportTool } from "./tool";

export const metadata: Metadata = { title: "Full paper report" };

export default function Page() {
  return <ReportTool />;
}
