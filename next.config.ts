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
    ];
  },
  async headers() {
    return [
      {
        // Site-wide security headers. Render sets none of these by default and
        // the origin was shipping with zero of them.
        //
        // CSP is deliberately REPORT-ONLY. Enforcing it today would silently
        // kill four inline scripts — the Consent Mode default snippet in
        // app/layout.tsx plus the GTM, GA4 and Meta Pixel initialisers in
        // components/analytics/ — and the failure mode is invisible: pages
        // render fine, analytics just stops.
        //
        // Fixing that properly needs a per-request nonce, which this static
        // headers() block cannot emit. proxy.ts IS the middleware (Next 16
        // renamed middleware.ts → proxy.ts), but its matcher is scoped to
        // /admin and /api/admin, so it never runs on the public routes that
        // would need the nonce. Widening it to all traffic puts the Edge
        // runtime in front of every public request — a deliberate
        // architectural change, not a free one.
        //
        // So: collect violations for a week via /api/csp-report, build the
        // allowlist from real traffic, then decide between a nonce (widen the
        // matcher) and a hash-based policy before switching the header name to
        // Content-Security-Policy.
        //
        // Both reporting mechanisms are wired because no browser supports both:
        // report-uri is all Firefox and Safari ever implemented, and report-to
        // is Chrome's Reporting API, which additionally requires the
        // Reporting-Endpoints header below to resolve the group name.
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
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is present ONLY because the four inline
              // initialisers have no nonce yet. Removing it is the whole point
              // of collecting reports first.
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net",
              "style-src 'self' 'unsafe-inline'",
              // R2 serves blog imagery; the analytics hosts serve tracking pixels.
              "img-src 'self' data: https://pub-cb13acd53ca84910bf06d95811396aed.r2.dev https://www.googletagmanager.com https://www.facebook.com",
              "font-src 'self' data:",
              "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net",
              // GTM's <noscript> iframe.
              "frame-src https://www.googletagmanager.com",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
              "report-uri /api/csp-report",
              "report-to csp-endpoint",
            ].join("; "),
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
