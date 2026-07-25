// Google Consent Mode v2 signals + shared consent helpers.
//
// Region-scoped: consent defaults to DENIED for EEA + UK + Switzerland and
// GRANTED everywhere else (so AU / US / rest-of-world analytics are unaffected).
// A visitor's explicit banner choice overrides the default and persists in
// localStorage so the banner shows once.

export const CONSENT_KEY = "archos_consent";

// EEA (EU-27 + IS/LI/NO) + UK + Switzerland. Google applies the region-scoped
// default based on the visitor's IP-detected region — no client geo needed.
export const EEA_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", // EU-27
  "IS", "LI", "NO", // EEA non-EU
  "GB", "CH", // UK + Switzerland
];

// The four Consent Mode v2 signals. ad_user_data + ad_personalization are the
// two added in v2 (on top of v1's ad_storage + analytics_storage).
export const GRANTED = {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
} as const;

export const DENIED = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
} as const;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    // Set true by the Meta Pixel init snippet when it revoked consent (so the
    // init PageView was suppressed). Lets applyConsent re-fire PageView on grant
    // ONLY for gated visitors — non-gated ones already counted one at init.
    __archosPixelGated?: boolean;
  }
}

// Inline script that sets Consent Mode v2 defaults BEFORE any Google tag loads:
// granted globally, denied for EEA+UK+CH, then re-applies the visitor's stored
// choice if they already decided. Pure string — dropped into a synchronous
// inline <script> so it runs ahead of the afterInteractive tags.
export function consentDefaultSnippet(): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',${JSON.stringify(GRANTED)});gtag('consent','default',Object.assign(${JSON.stringify(DENIED)},{region:${JSON.stringify(EEA_REGIONS)},wait_for_update:500}));try{var c=localStorage.getItem('${CONSENT_KEY}');if(c==='granted'){gtag('consent','update',${JSON.stringify(GRANTED)});}else if(c==='denied'){gtag('consent','update',${JSON.stringify(DENIED)});}}catch(e){}`;
}

// Client-side: apply a banner choice to both Google (Consent Mode update) and
// Meta (grant/revoke + fire the PageView that was held back), then persist it.
export function applyConsent(granted: boolean): void {
  window.gtag?.("consent", "update", granted ? GRANTED : DENIED);
  if (granted) {
    window.fbq?.("consent", "grant");
    // Re-fire PageView ONLY if the init snippet gated (suppressed) it. Non-gated
    // visitors already counted a PageView at init, so firing again double-counts.
    if (window.__archosPixelGated) {
      window.fbq?.("track", "PageView");
      window.__archosPixelGated = false;
    }
  } else {
    window.fbq?.("consent", "revoke");
  }
  try {
    localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  } catch {
    // localStorage unavailable (private mode) — the choice just isn't persisted.
  }
}
