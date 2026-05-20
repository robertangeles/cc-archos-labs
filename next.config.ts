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
};

export default nextConfig;
