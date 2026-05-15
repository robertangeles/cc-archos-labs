import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Header } from "../components/layout/header";
import { Footer } from "../components/layout/footer";
import { getSignedInLead } from "../lib/lead-display";
import {
  buildPageMetadata,
  getSiteSettings,
  getSiteUrl,
} from "../lib/site-config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // Root metadata — title + OG defaults derived from site_setting admin row.
  // Per-page metadata overrides specific fields via buildPageMetadata({title, description, path}).
  return buildPageMetadata({});
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
    address: {
      "@type": "PostalAddress",
      addressLocality: "Sydney",
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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <Header
          lead={
            signedInLead ? { firstName: signedInLead.firstName } : null
          }
        />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
