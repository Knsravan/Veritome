import type { Metadata } from "next";
import { NOINDEX } from "@/lib/site";
import { SettingsForm } from "./form";

export const metadata: Metadata = { title: "Settings", robots: NOINDEX };

export default function Page() {
  return <SettingsForm />;
}
