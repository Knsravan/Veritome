import type { Metadata } from "next";
import { HistoryList } from "./list";

export const metadata: Metadata = { title: "History" };

export default function Page() {
  return <HistoryList />;
}
