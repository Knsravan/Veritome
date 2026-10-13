"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { keepGlass, useGlass } from "@/lib/ui-style";

/** While the glass preview is kept on, a small bar on every page says so and turns it off. */
export function GlassBar() {
  const { kept } = useGlass();
  const path = usePathname();
  if (!kept || path === "/preview/glass") return null;
  return (
    <div
      role="status"
      className="card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-2 text-sm print:hidden"
    >
      <span className="font-semibold">Glass preview is on</span>
      <Link href="/preview/glass" className="text-action hover:underline">
        Preview page
      </Link>
      <button type="button" onClick={() => keepGlass(false)} className="font-semibold text-action hover:underline">
        Turn off
      </button>
    </div>
  );
}
