// The Content-Security-Policy, in one place.
//
// It lives here rather than in next.config.ts because it needs a per-request
// nonce, and `headers()` in next.config.ts is static config evaluated once at
// build time. proxy.ts calls buildCsp() on every request and sets the header
// itself. The other five security headers stay in next.config.ts, because they
// are the same string for every request and belong with the static config.
//
// Edge-runtime safe on purpose: pure string building, no Node built-ins, since
// proxy.ts runs in the Edge runtime.

/**
 * Hosts that serve executable script. Kept as a host allowlist rather than
 * folded into 'strict-dynamic' — see the note on buildCsp.
 */
export const SCRIPT_HOSTS = [
  "https://*.googletagmanager.com",
  "https://connect.facebook.net",
  "https://challenges.cloudflare.com",
] as const;

const IMG_HOSTS = [
  "https://pub-cb13acd53ca84910bf06d95811396aed.r2.dev",
  "https://*.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://www.facebook.com",
] as const;

const CONNECT_HOSTS = [
  // GA4 does not always send to www.google-analytics.com: it routes some
  // traffic to regional endpoints (region1.google-analytics.com and friends)
  // and to *.analytics.google.com.
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
  // gtag.js builds this transport host at RUNTIME, so it appears in no source
  // file and no served markup. Measured on production: page_view, scroll and
  // user_engagement all post to https://www.google.com/g/collect. Omitting it
  // drops GA4 measurement outright, silently.
  "https://www.google.com",
  // fbevents.js's primary transport is an img-src Image() GET, but it falls
  // back to sendBeacon/fetch against https://www.facebook.com/tr/ on unload.
  "https://www.facebook.com",
  "https://connect.facebook.net",
  // NOT our Turnstile widget, which is off. Cloudflare injects a
  // bot-management beacon to /cdn-cgi/challenge-platform/... at the edge, after
  // parse, on proxied pages. Live today. See
  // wiki/decisions/2026-07-30-csp-enforcing.md before removing this.
  "https://challenges.cloudflare.com",
] as const;

const FRAME_HOSTS = [
  // GTM's <noscript> iframe, and Turnstile's challenge iframe.
  "https://*.googletagmanager.com",
  "https://challenges.cloudflare.com",
] as const;

/** 128 bits of randomness, base64'd. Fresh per request — that is the point. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the policy for one request.
 *
 * WHY NONCE AND NOT 'strict-dynamic'
 *
 * The textbook strict CSP is `'nonce-X' 'strict-dynamic' https: 'unsafe-inline'`,
 * and it is tempting because it makes the host allowlist irrelevant. It is the
 * wrong choice for this site, for a reason specific to it: 'strict-dynamic'
 * makes browsers IGNORE host allowlists, and trust only scripts injected by an
 * already-trusted script. Two things here are parser-inserted and carry no
 * nonce, so they would break:
 *
 *   1. Cloudflare injects a bot-management script at the edge, after our HTML
 *      is generated. We never see it and cannot nonce it.
 *   2. GTM-injected tags are createElement-inserted and WOULD survive
 *      'strict-dynamic' — but only because GTM's own loader is nonced. Any tag
 *      an operator adds to the container that Google injects differently would
 *      not, and that failure is silent.
 *
 * Keeping the host allowlist means both keep working, and dropping
 * 'unsafe-inline' from script-src still closes the actual XSS hole: injected
 * inline script no longer executes, because an attacker cannot guess the nonce.
 *
 * style-src KEEPS 'unsafe-inline'. Next.js and the font loader emit inline
 * style attributes and <style> blocks that are not nonce-able without a much
 * larger change, and inline CSS is a far weaker vector than inline script.
 * Stated plainly rather than left to look like an oversight.
 */
export function buildCsp(
  nonce: string,
  isDev = process.env.NODE_ENV === "development",
): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: Turbopack's dev-mode RSC streaming deserializer
    // calls eval() to reconstruct cross-environment stack traces for better
    // debugging. Without it the app still works — React catches the blocked
    // eval() and no-ops — but the console logs a warning on every page. Never
    // shipped to production, where React does not use eval() at all.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} ${SCRIPT_HOSTS.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    // blob: — the Watermark Remover tool (app/tools/watermark-remover)
    // previews a cleaned image via URL.createObjectURL(), entirely
    // client-side; no other page on the site creates object URLs.
    `img-src 'self' data: blob: ${IMG_HOSTS.join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_HOSTS.join(" ")}`,
    `frame-src ${FRAME_HOSTS.join(" ")}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Reporting survives the move to nonces. GTM can inject a tag from a host
    // this allowlist does not cover, and no amount of reading our own code
    // catches that — disposition:"enforce" in the /api/csp-report logs is the
    // early warning. Both mechanisms because no browser supports both:
    // report-uri is all Firefox and Safari implemented, report-to is Chrome's
    // Reporting API and needs the Reporting-Endpoints header from
    // next.config.ts to resolve the group name.
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join("; ");
}
