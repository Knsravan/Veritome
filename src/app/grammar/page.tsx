import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Grammar (coming soon)" };

export default function Page() {
  return <ComingSoon href="/grammar" />;
}
