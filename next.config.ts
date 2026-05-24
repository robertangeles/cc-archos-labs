import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Cloudflare R2 public bucket — featured + inline images for /blog
    // posts live here (uploaded by scripts/migrate-wp/media-rehost.ts).
    // Source aspect ratios vary; rendered thumbnails crop via object-cover.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-cb13acd53ca84910bf06d95811396aed.r2.dev",
        pathname: "/blog/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Edge-cache the sitemap for 1h, serve stale up to 24h while
        // Cloudflare revalidates. Defense-in-depth with the route's ISR
        // (revalidate=3600) — even on a Render cold start, Cloudflare
        // serves the cached body so Googlebot never waits on origin.
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
