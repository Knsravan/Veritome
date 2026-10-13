import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Lets search engines read the public pages, not the API or a visitor's own history and settings. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/history", "/settings"] },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
