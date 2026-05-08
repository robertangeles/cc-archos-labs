import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/site-config";

// Next.js native robots.txt. Allows public site, blocks /admin and
// /api/admin (the operator UI shouldn't be indexed). Sitemap pointer
// helps Google + Bing discover all routes.

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/admin/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
