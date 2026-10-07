"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DocModel } from "@/lib/doc/model";
import type { ImageReport } from "@/lib/images/analyze";

const Ctx = createContext<{ doc: DocModel | null; images: ImageReport | null }>({ doc: null, images: null });

/** Makes the uploaded document (with its layout) and its image checks available to every result view below. */
export function DocumentProvider({ doc, images = null, children }: { doc: DocModel | null; images?: ImageReport | null; children: ReactNode }) {
  return <Ctx.Provider value={{ doc, images }}>{children}</Ctx.Provider>;
}

/** The uploaded document, when it is the one whose text was checked. */
export function useDocModel(text: string): DocModel | null {
  const { doc } = useContext(Ctx);
  return doc && doc.text === text ? doc : null;
}

export function useImageReport(): ImageReport | null {
  return useContext(Ctx).images;
}
