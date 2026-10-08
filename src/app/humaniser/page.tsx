import type { Metadata } from "next";
import { HumaniserTool } from "./tool";

export const metadata: Metadata = { title: "Humaniser" };

export default function Page() {
  return <HumaniserTool />;
}
