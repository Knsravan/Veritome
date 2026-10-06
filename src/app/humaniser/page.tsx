import type { Metadata } from "next";
import { RewriteTool } from "@/components/RewriteTool";

export const metadata: Metadata = { title: "Humaniser" };

export default function Page() {
  return <RewriteTool kind="humanise" />;
}
