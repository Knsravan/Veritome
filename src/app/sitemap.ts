import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { TOOLS } from "@/lib/tools";

/** The public pages, for search engines. Tools that are not open yet, and personal pages, are left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const at = (path: string) => new URL(path, base).toString();
  return [
    { url: at("/"), changeFrequency: "monthly", priority: 1 },
    ...TOOLS.filter((t) => !t.soon).map((t) => ({ url: at(t.href), changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: at("/ai-rules"), changeFrequency: "monthly", priority: 0.6 },
    { url: at("/about"), changeFrequency: "yearly", priority: 0.5 },
  ];
}
