import type { Metadata } from "next";
import { SettingsForm } from "./form";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsForm />;
}
