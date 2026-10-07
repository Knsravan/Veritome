"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DocModel } from "@/lib/doc/model";

const Ctx = createContext<DocModel | null>(null);

/** Makes the uploaded document (with its layout) available to every result view below. */
export function DocumentProvider({ doc, children }: { doc: DocModel | null; children: ReactNode }) {
  return <Ctx.Provider value={doc}>{children}</Ctx.Provider>;
}

/** The uploaded document, when it is the one whose text was checked. */
export function useDocModel(text: string): DocModel | null {
  const doc = useContext(Ctx);
  return doc && doc.text === text ? doc : null;
}
