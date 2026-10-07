import type { Metadata } from "next";
import { LogoLab } from "./lab";

export const metadata: Metadata = { title: "Logo options", robots: { index: false, follow: false } };

export default function Page() {
  return <LogoLab />;
}
