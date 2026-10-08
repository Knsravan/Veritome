import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Compare papers (coming soon)" };

export default function Page() {
  return <ComingSoon href="/compare" />;
}
