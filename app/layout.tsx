import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "../components/layout/header";
import { Footer } from "../components/layout/footer";
import {
  GoogleTagManager,
  GoogleTagManagerNoScript,
} from "../components/analytics/google-tag-manager";
import { MetaPixel } from "../components/analytics/meta-pixel";
import { GoogleAnalytics } from "../components/analytics/google-analytics";
import { ConsentBanner } from "../components/analytics/consent-banner";
import { consentDefaultSnippet } from "../components/analytics/consent";
import { SearchProvider } from "../components/search/search-provider";
import { getSignedInLead } from "../lib/lead-display";
import {
  buildPageMetadata,
  getSiteSettings,
  getSiteUrl,
} from "../lib/site-config";
import { jsonLdScript } from "../lib/structured-data";
import "./globals.css";

// Geist Sans + Geist Mono — DESIGN.md §347 lists Geist Sans as a viable
// substitute for Linear's proprietary display/text faces, and Geist Mono
// approximates Linear Mono. Both load via next/font/google so they're
// self-hosted at build time (no FOIT, no third-party request at runtime).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const meta = await buildPageMetadata({});
  return {
    ...meta,
    alternates: {
      ...meta.alternates,
      types: {
        "application/rss+xml": "/blog/feed.xml",
      },
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  // Read the lead session (if any) once at the root so the Header can
  // render the right auth state. cache() dedupes within the request, so
  // any descendant server component that calls getSignedInLead() reuses
  // this DB hit.
  const signedInLead = await getSignedInLead();

  // JSON-LD for AI assistants + Google Knowledge Panel. Organization +
  // Person (founder) schemas — clear, factual, machine-readable. Updated
  // every time the admin saves site_setting because settings flow through.
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.siteName,
    url: siteUrl,
    logo: `${siteUrl}/images/logo.png`,
    description: settings.description,
    foundingDate: "2026",
    // Melbourne, not Sydney. Every user-facing surface (home, /about,
    // /consulting) says Melbourne; this block said Sydney, so the one
    // machine-readable statement of where the business is was the only
    // one that was wrong. addressRegion disambiguates from Melbourne,
    // Florida. Unrelated to the Australia/Sydney IANA strings elsewhere —
    // those are the timezone, which Melbourne shares.
    address: {
      "@type": "PostalAddress",
      addressLocality: "Melbourne",
      addressRegion: "VIC",
      addressCountry: "AU",
    },
    sameAs: [settings.linkedinUrl].filter(Boolean),
    founder: {
      "@type": "Person",
      name: settings.founderName,
      jobTitle: "Founder & Principal Practitioner",
      sameAs: [settings.founderLinkedinUrl].filter(Boolean),
    },
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.siteName,
    url: siteUrl,
    description: settings.description,
  };

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink font-sans">
        {/* Consent Mode v2 defaults — a synchronous inline script so it runs
            BEFORE the afterInteractive Google tags. Region-scoped: denied for
            EEA+UK+CH, granted elsewhere; re-applies any stored choice. */}
        {(process.env.NEXT_PUBLIC_GA_ID || process.env.NEXT_PUBLIC_GTM_ID) && (
          <script
            dangerouslySetInnerHTML={{ __html: consentDefaultSnippet() }}
          />
        )}
        {/* GTM <noscript> first thing after <body>. Env-driven; no-ops unset. */}
        <GoogleTagManagerNoScript gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
        {/* Meta Pixel — installed in code, NOT in GTM (don't add it there too,
            or PageViews double-count). No-ops when the id is unset. Placed
            right after GTM's noscript so its own <noscript> beacon sits as
            early in <body> as possible (Meta's placement guidance). */}
        <MetaPixel pixelId={process.env.NEXT_PUBLIC_FB_PIXEL_ID} />
        {/* GA4 (gtag.js) — installed in code, NOT in GTM (don't add a GA4 tag
            there too, or page_views double-count). No-ops when the id is unset. */}
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
        {/* Cookie-consent banner — shows once; Accept/Reject applies to GA4 +
            Meta live. Enabled whenever any tracker is configured. */}
        <ConsentBanner
          enabled={Boolean(
            process.env.NEXT_PUBLIC_GA_ID ||
              process.env.NEXT_PUBLIC_GTM_ID ||
              process.env.NEXT_PUBLIC_FB_PIXEL_ID,
          )}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteSchema) }}
        />
        <SearchProvider>
          <Header
            lead={
              signedInLead ? { firstName: signedInLead.firstName } : null
            }
          />
          <div className="flex-1 flex flex-col">{children}</div>
          <Footer />
        </SearchProvider>
      </body>
    </html>
  );
}
