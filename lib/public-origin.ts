import "server-only";

// Build a publicly-reachable origin string for routes that emit URLs
// going OUT OF BAND — embedded in emails, returned to clients as JSON,
// used as `Location` headers on redirects, etc.
//
// Why this helper exists:
//
// On Render's runtime, `new URL(request.url).origin` reconstructs to
// `https://localhost:10000` — the edge sets `X-Forwarded-Proto: https`
// but the internal Node process binds at `localhost:10000` over HTTP.
// Next.js's URL constructor combines those signals into a value that's
// neither what the user typed nor anything the user can reach. Any
// URL we hand back to the user, or any redirect we issue, must use
// the *public* origin, not whatever request.url reports.
//
// Trade-off: in local dev there's no `NEXT_PUBLIC_SITE_URL` mismatch
// (it's set to the localhost dev URL in .env.local), so the fallback
// path is fine. Production must have `NEXT_PUBLIC_SITE_URL` set to the
// real public origin — same env var the metadata builder, sitemap, OG
// cards, and JSON-LD already depend on.

export function getPublicOrigin(request: Request): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envOrigin) {
    return envOrigin.replace(/\/$/, "");
  }
  return new URL(request.url).origin;
}
