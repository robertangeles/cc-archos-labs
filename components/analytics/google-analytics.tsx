import Script from "next/script";

// A GA4 Measurement ID looks like G-XXXXXXXXXX. Reject anything else before it
// reaches the inline-script interpolation (defense-in-depth, mirrors the GTM
// and Meta Pixel id guards).
const GA_ID_RE = /^G-[A-Z0-9]+$/;

export function isValidGaId(gaId: string | undefined): gaId is string {
  return !!gaId && GA_ID_RE.test(gaId);
}

// The GA4 gtag config snippet with the id interpolated. Pure + exported so the
// interpolation is unit-testable without a DOM.
export function ga4ConfigSnippet(gaId: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`;
}

// Google Analytics 4 (gtag.js) — installed in code, NOT via GTM. Do not also
// add a GA4 tag inside GTM with the same id or page_views double-count.
// Renders nothing when the id is unset/malformed, so dev and preview never
// load GA or pollute production metrics.
//
// SPA page views: gtag's config fires the first page_view, and GA4 Enhanced
// Measurement ("page changes based on browser history events" — ON by default)
// fires subsequent ones on Next.js client navigations, which use the History
// API. No per-route JS is needed here as long as Enhanced Measurement is on.
export function GoogleAnalytics({
  gaId,
  nonce,
}: {
  gaId?: string;
  nonce?: string;
}) {
  if (!isValidGaId(gaId)) return null;

  return (
    <>
      {/* nonce on the external tag too, even though script-src allowlists the
          host and does not require it: gtag.js reads the nonce off its own
          script element and copies it onto the tags it injects at runtime. That
          propagation is what keeps GA4's dynamically-added scripts working. */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
        {ga4ConfigSnippet(gaId)}
      </Script>
    </>
  );
}
