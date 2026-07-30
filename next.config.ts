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
        // CSP is ENFORCING as of 2026-07-30, graduated from Report-Only after
        // the report stream was checked and the allowlist verified by
        // inspection. What that check found:
        //
        //   - Two violations total across two days. One was a synthetic probe
        //     fired to prove delivery works; the other was a visitor's browser
        //     extension beaconing to an *.on.aws endpoint. Deliberately NOT
        //     allowlisted — blocking it is the policy working.
        //   - Every host CSP governs across /, /about, /blog, a post,
        //     /consulting, /contact and both /tools pages was already listed.
        //     Outbound <a href> targets (github, linkedin, x, huggingface) are
        //     navigation, which CSP does not govern.
        //
        // 'unsafe-inline' STAYS in script-src, so this does not stop inline
        // injection — it enforces the external-script allowlist plus
        // object-src, base-uri, form-action and frame-ancestors. Waiting longer
        // could never have changed that: with 'unsafe-inline' present, inline
        // scripts never report at all, so the report stream had no inline data
        // to give. Removing it needs a per-request nonce, which this static
        // headers() block cannot emit. proxy.ts IS the middleware (Next 16
        // renamed middleware.ts → proxy.ts) but its matcher is scoped to /admin
        // and /api/admin, so it never runs on the public routes that need the
        // nonce. Widening it puts the Edge runtime in front of every public
        // request — a deliberate architectural change, tracked separately.
        //
        // A hash-based policy is not the shortcut it looks like: the homepage
        // alone emits 21 Next.js RSC flight-data blocks whose contents change
        // every render, so their hashes are not knowable at config time.
        //
        // Reporting stays wired after the flip — an enforcing policy still
        // reports, and those reports are now the early-warning system for the
        // one thing this allowlist cannot cover: GTM can inject arbitrary tags
        // at runtime, so a tag added to the container later will be blocked.
        // Watch for disposition:"enforce" in /api/csp-report logs.
        //
        // Both mechanisms are wired because no browser supports both:
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
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is present ONLY because the inline initialisers
              // and Next's own RSC blocks have no nonce. See the note above.
              // challenges.cloudflare.com is Turnstile, loaded dynamically by
              // app/(auth)/turnstile-widget.tsx on login, register,
              // forgot-password and the booking form. It is DB-toggleable and
              // currently defaults OFF, so it emits nothing today — but the
              // widget tolerates a missing script silently ("the form still
              // works without a token"), so leaving it out would disable the bot
              // gate on auth and booking with no visible error at all the moment
              // someone flips that setting on. It is listed for that reason.
              "script-src 'self' 'unsafe-inline' https://*.googletagmanager.com https://connect.facebook.net https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              // R2 serves blog imagery; the analytics hosts serve tracking pixels.
              "img-src 'self' data: https://pub-cb13acd53ca84910bf06d95811396aed.r2.dev https://*.googletagmanager.com https://*.google-analytics.com https://www.facebook.com",
              "font-src 'self' data:",
              // Wildcards, not www., because GA4 does not always send to
              // www.google-analytics.com — it routes some traffic to regional
              // endpoints (region1.google-analytics.com and friends) and to
              // *.analytics.google.com.
              //
              // www.google.com is here for a reason that cost a near-miss to
              // find. gtag.js builds its transport host at RUNTIME, so it never
              // appears in the served HTML and never showed up in the two
              // Report-Only violations either. Driving a real browser against an
              // enforcing policy showed page_view, scroll AND user_engagement
              // all posting to https://www.google.com/g/collect (gaf=1) with
              // NOTHING going to google-analytics.com on that load. Omitting it
              // does not merely lose Google Signals — it drops GA4 measurement
              // outright, silently, with the page rendering perfectly.
              //
              // Not covered on purpose: the country-TLD variants
              // (www.google.com.au and friends) that GA4 can use for ads cookie
              // sync. Nothing in this stack requests them today, and guessing at
              // a list of Google ccTLDs is a worse trade than letting
              // /api/csp-report tell us if one ever fires.
              //
              // www.facebook.com (as opposed to just connect.facebook.net,
              // which only loads the script) is here because fbevents.js does
              // not exclusively report events via the img-src-covered Image()
              // GET beacon: inspecting the live script shows it also falls
              // back to navigator.sendBeacon and fetch — both connect-src, not
              // img-src — targeting https://www.facebook.com/tr/, at minimum
              // on page unload. Meta Pixel is DB-toggleable and has no
              // configured id today, so this is inert — but the img-src entry
              // alone would leave those beacon-based events silently blocked
              // the moment a pixel id is set.
              //
              // challenges.cloudflare.com is here for the same shape of reason.
              // Turnstile's core token issuance runs in its iframe and talks to
              // the parent by postMessage, which no CSP directive governs — that
              // path is already covered by script-src + frame-src. But api.js
              // also fetch/sendBeacons to /cdn-cgi/challenge-platform/... from
              // the TOP-LEVEL page for clearance redemption, and that flow is
              // gated on the site running Turnstile as part of a Cloudflare Zone
              // integration. This site IS Cloudflare-fronted, so that is a live
              // configuration rather than a hypothetical one. The host is
              // already trusted in script-src, and a host allowed to execute
              // arbitrary script in the page can do anything a fetch could, so
              // listing it here grants essentially no additional surface.
              "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.google.com https://www.facebook.com https://connect.facebook.net https://challenges.cloudflare.com",
              // GTM's <noscript> iframe, and Turnstile's challenge iframe.
              "frame-src https://*.googletagmanager.com https://challenges.cloudflare.com",
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
