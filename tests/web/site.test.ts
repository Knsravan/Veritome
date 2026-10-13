import { describe, expect, test } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { pageMetadata, siteUrl } from "@/lib/site";
import { TOOLS } from "@/lib/tools";

describe("site address and search-engine files", () => {
  test("SITE_URL wins, then Vercel's production domain, then localhost", () => {
    expect(siteUrl({ SITE_URL: "https://veritome.org", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).href).toBe("https://veritome.org/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "veritome-team.vercel.app" }).href).toBe("https://veritome-team.vercel.app/");
    expect(siteUrl({ SITE_URL: "veritome.org" }).href).toBe("https://veritome.org/");
    expect(siteUrl({ SITE_URL: "http://[bad", VERCEL_PROJECT_PRODUCTION_URL: "ok.vercel.app" }).href).toBe("https://ok.vercel.app/");
    expect(siteUrl({ PORT: "4000" }).href).toBe("http://localhost:4000/");
  });

  test("the sitemap lists the home page and open tools only, as full addresses", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.every((u) => /^https?:\/\//.test(u))).toBe(true);
    for (const t of TOOLS) expect(urls.some((u) => u.endsWith(t.href))).toBe(!t.soon);
    expect(urls.some((u) => /\/(history|settings|api)/.test(u))).toBe(false);
  });

  test("robots keeps crawlers out of the API and personal pages and points at the sitemap", () => {
    const r = robots();
    expect(r.rules).toMatchObject({ allow: "/", disallow: ["/api/", "/history", "/settings"] });
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  test("page metadata carries the description, canonical address and preview text", () => {
    const m = pageMetadata({ title: "Paraphraser", description: "Rewords text.", path: "/paraphraser" });
    expect(m).toMatchObject({
      title: "Paraphraser",
      description: "Rewords text.",
      alternates: { canonical: "/paraphraser" },
      openGraph: { title: "Paraphraser · Veritome", url: "/paraphraser", description: "Rewords text." },
      twitter: { card: "summary_large_image" },
    });
  });
});
