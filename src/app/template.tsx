import type { ReactNode } from "react";

/** Each page fades up gently on navigation. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
