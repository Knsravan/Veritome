import type { Metadata } from "next";
import { NOINDEX } from "@/lib/site";
import { HistoryList } from "./list";

export const metadata: Metadata = { title: "History", robots: NOINDEX };

export default function Page() {
  return <HistoryList />;
}
