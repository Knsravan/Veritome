import type { Metadata } from "next";
import { NOINDEX } from "@/lib/site";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Citations (coming soon)", robots: NOINDEX };

export default function Page() {
  return <ComingSoon href="/citations" />;
}
