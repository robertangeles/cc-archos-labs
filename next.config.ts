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
  async redirects() {
    return [
      {
        source:
          "/blog/ai-workforce-strategy-without-people-plansai-workforce-strategy-without-people-plans",
        destination: "/blog/ai-workforce-strategy-without-people-plans",
        permanent: true,
      },
      {
        // Duplicate of the post below, and the weaker of the two: 5,871 chars
        // against 7,358, no featured image, same category, near-identical
        // excerpt. Both were published within 17 hours on 2026-08-03/04.
        //
        // Not a planning mistake — it is the orphan half of the `finish()`
        // bug fixed in lib/blog-agent/run.ts. The first run committed this
        // post and died before attaching the illustration; the sweeper
        // reclaimed the queue item and the retry wrote the -no-it-team slug,
        // which took the post_id pointer and left this one live and untracked.
        //
        // 301 rather than a delete so any link equity lands on the survivor.
        source: "/blog/six-week-ai-readiness-sprint-small-business",
        destination: "/blog/six-week-ai-readiness-sprint-small-business-no-it-team",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Site-wide security headers. Render sets none of these by default and
        // the origin was shipping with zero of them.
        //
        // The Content-Security-Policy is NOT here. It needs a per-request nonce,
        // and this headers() block is static config evaluated once at build
        // time, so a nonce set here would be identical on every response, which
        // is not a nonce. It lives in lib/csp.ts and is set by proxy.ts on every
        // request. Do not add a CSP here as well: two Content-Security-Policy
        // headers are each enforced independently, so a resource has to satisfy
        // BOTH, and the interaction is a confusing way to break the site.
        //
        // Reporting-Endpoints stays here because it is the same string on every
        // response. It declares the group name that the policy's `report-to`
        // directive refers to; Chrome silently drops violations without it, and
        // Firefox and Safari only ever implemented `report-uri`.
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Reporting-Endpoints",
            value: 'csp-endpoint="/api/csp-report"',
          },
        ],
      },
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
