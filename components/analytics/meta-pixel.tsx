"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

// A Meta Pixel ID is all digits. Reject anything else before it reaches the
// inline-script interpolation (defense-in-depth, mirrors the GTM id guard).
const PIXEL_ID_RE = /^[0-9]+$/;

export function isValidPixelId(pixelId: string | undefined): pixelId is string {
  return !!pixelId && PIXEL_ID_RE.test(pixelId);
}

// The Meta Pixel base snippet with the id interpolated. Pure + exported so the
// interpolation is unit-testable without a DOM.
export function metaPixelSnippet(pixelId: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

// The init snippet fires the FIRST PageView when it loads. Next.js navigations
// are client-side, so subsequent views never reach Meta unless we fire them.
// Skip the initial effect (already counted) and fire on every navigation after.
function PixelRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname, searchParams]);

  return null;
}

// Meta (Facebook) Pixel — installed in code (NOT via GTM) so it is owned and
// verifiable end-to-end. Do not also add a Meta Pixel tag inside GTM or every
// PageView double-counts. Renders nothing when the id is unset/malformed, so
// dev and preview never load the pixel.
export function MetaPixel({ pixelId }: { pixelId?: string }) {
  if (!isValidPixelId(pixelId)) return null;

  return (
    <>
      <Script id="meta-pixel-init" strategy="afterInteractive">
        {metaPixelSnippet(pixelId)}
      </Script>
      <noscript>
        {/* 1x1 tracking beacon for no-JS visitors. Raw img, not next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
      {/* useSearchParams must sit under Suspense or it de-opts the whole
          route to client-side rendering. */}
      <Suspense fallback={null}>
        <PixelRouteTracker />
      </Suspense>
    </>
  );
}
