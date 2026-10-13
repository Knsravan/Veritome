import { vi } from "vitest";

/**
 * Browser APIs jsdom lacks that the result views use: reduced motion (so counters show their final value at once)
 * and scrolling a mark or note into view.
 */
export function stubLayoutApis(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  Element.prototype.scrollIntoView ??= () => {};
}
