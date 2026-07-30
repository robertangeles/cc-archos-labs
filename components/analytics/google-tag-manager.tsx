import Script from "next/script";

// GTM container ids always match GTM-[A-Z0-9]+. Guard against a fat-fingered
// or misconfigured env var before the id is interpolated into an inline
// <Script> (dangerouslySetInnerHTML internally) or a URL src attribute.
const GTM_ID_RE = /^GTM-[A-Z0-9]+$/;

// The Google Tag Manager loader snippet, with the container id interpolated.
// Pure + exported so the id-interpolation is unit-testable without a DOM.
export function gtmSnippet(gtmId: string): string {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`;
}

// Google Tag Manager container loader. GA4, Meta Pixel, and any future tags
// are configured INSIDE the GTM dashboard — no code deploy to add or change a
// tag. Renders nothing when the id is unset (local dev, preview) so those
// environments never load GTM or pollute production metrics.
//
// SPA page views are handled by config, not code: GA4 Enhanced Measurement
// tracks history-change navigations automatically, and Meta Pixel uses GTM's
// built-in History Change trigger. Next.js client navigation uses the History
// API, so both fire on route changes with no per-route JS here.
export function GoogleTagManager({
  gtmId,
  nonce,
}: {
  gtmId?: string;
  nonce?: string;
}) {
  if (!gtmId || !GTM_ID_RE.test(gtmId)) return null;
  return (
    <Script id="gtm-init" strategy="afterInteractive" nonce={nonce}>
      {gtmSnippet(gtmId)}
    </Script>
  );
}

// GTM's <noscript> fallback. Google requires it immediately after the opening
// <body> tag, so the layout renders it as body's first child (separate from
// the loader above, which Next injects near the top of the document).
export function GoogleTagManagerNoScript({ gtmId }: { gtmId?: string }) {
  if (!gtmId || !GTM_ID_RE.test(gtmId)) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
