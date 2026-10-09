import type { Metadata } from "next";
import { ParaphraserTool } from "./tool";

export const metadata: Metadata = { title: "Paraphraser" };

export default function Page() {
  return <ParaphraserTool />;
}
