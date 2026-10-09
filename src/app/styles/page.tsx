import type { Metadata } from "next";
import { StyleGallery } from "./gallery";

export const metadata: Metadata = {
  title: "Control styles",
  description: "Neumorphic buttons, toggles and sliders to choose from.",
  robots: { index: false, follow: false },
};

export default function StylesPage() {
  return (
    <article className="max-w-6xl">
      <header className="animate-fade-up mb-10 max-w-2xl">
        <p className="text-sm font-semibold tracking-wide text-action uppercase">Test page</p>
        <h1 className="font-display mt-1 text-3xl font-semibold sm:text-4xl">Pick your control styles</h1>
        <p className="mt-3 text-ink-soft">
          Every control below is neumorphic and animated. Click, press, drag and use the keyboard on each one, in light and
          dark. Then tell me one letter for buttons, one for toggles and one for sliders (for example “Buttons B, Toggles A,
          Sliders C”), and I will use them across the whole site.
        </p>
      </header>
      <StyleGallery />
    </article>
  );
}
