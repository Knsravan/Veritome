import type { Metadata } from "next";

export const SITE_NAME = "Veritome";
export const SITE_TITLE = "Veritome: check your paper before you submit";
export const SITE_DESCRIPTION =
  "Open-source pre-publication checks for researchers: plagiarism, AI-writing patterns, citations and grammar, with the evidence and limits shown for every result.";

/**
 * The site's public address, which search engines and link previews need in full. SITE_URL wins; on Vercel the
 * production domain (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel) is used, so previews still point at the real site.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  for (const candidate of [env.SITE_URL?.trim(), env.VERCEL_PROJECT_PRODUCTION_URL?.trim()]) {
    if (!candidate) continue;
    try {
      return new URL(/^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`);
    } catch {
      // Not a usable address; try the next one.
    }
  }
  return new URL(`http://localhost:${env.PORT ?? 3000}`);
}

/**
 * Title, description, canonical address and link-preview text for a public page. The preview image comes from
 * app/opengraph-image.tsx.
 */
export function pageMetadata({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: { siteName: SITE_NAME, type: "website", locale: "en", url: path, title: title ? `${title} · ${SITE_NAME}` : SITE_TITLE, description },
    twitter: { card: "summary_large_image", title: title ? `${title} · ${SITE_NAME}` : SITE_TITLE, description },
  };
}

/** For pages that should stay out of search results (personal pages, tools not open yet). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: true };
