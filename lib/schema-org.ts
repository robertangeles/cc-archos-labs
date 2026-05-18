// Schema.org JSON-LD for surfaces that need page-specific structured data.
//
// The root Organization + WebSite schemas are already rendered globally in
// app/layout.tsx (driven by site_setting). This module supplements them
// with page-specific schemas that don't belong at the layout level.
//
// Current consumers:
//   - app/page.tsx → homePageServicesLd (three Service entities for the
//     three service lines listed in the home Services section)
//
// Per CLAUDE.md rule, we never publish prices, so the Service entities have
// no Offer attached. Service.areaServed signals Australia coverage for AIEO
// queries like "AI consultants in Australia" without committing to LocalBusiness
// semantics (which Organization already covers via address.PostalAddress).
//
// All values are static. No user input flows into these objects.

type SchemaService = {
  "@context": "https://schema.org";
  "@type": "Service";
  name: string;
  description: string;
  provider: { "@type": "Organization"; name: string };
  areaServed: { "@type": "Country"; name: string };
};

// Person schema rendered on /about. Anchors Rob as a recognisable entity
// for LLM citation graphs + Google Knowledge Panel. `sameAs` reinforces
// identity through the LinkedIn + Modelling Room links shown on the page
// — keep both surfaces driven by the same DB-backed `site_setting` row so
// they cannot drift. Empty URLs are filtered out so unconfigured fields
// don't produce broken anchors in the JSON-LD.
type SchemaPerson = {
  "@context": "https://schema.org";
  "@type": "Person";
  name: string;
  jobTitle: string;
  worksFor: { "@type": "Organization"; name: string; url: string };
  url: string;
  knowsAbout: string[];
  sameAs?: string[];
};

export function buildAboutPagePersonLd(args: {
  founderName: string;
  orgName: string;
  siteUrl: string;
  /** URLs that identify the founder across the web — LinkedIn, X,
   *  GitHub, Hugging Face, the Modelling Room newsletter, etc. Empty
   *  strings are filtered out so unconfigured entries don't produce
   *  broken anchors in the JSON-LD payload. */
  sameAs: string[];
}): SchemaPerson {
  const cleanSameAs = args.sameAs
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const person: SchemaPerson = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: args.founderName,
    jobTitle: "Principal Consultant",
    worksFor: {
      "@type": "Organization",
      name: args.orgName,
      url: args.siteUrl,
    },
    url: `${args.siteUrl}/about`,
    knowsAbout: [
      "Data Architecture",
      "AI Agent Development",
      "Data Lineage",
      "Data Governance",
      "Domain Modelling",
      "AI Readiness",
      "Enterprise AI",
    ],
  };
  if (cleanSameAs.length > 0) {
    person.sameAs = cleanSameAs;
  }
  return person;
}

export function buildHomePageServicesLd(orgName: string): SchemaService[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "AI Readiness Assessment",
      description:
        "Two-week written assessment of your data foundation and governance against what your AI program needs. CFO/board-actionable output — no frameworks, no slide decks.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Data Architecture",
      description:
        "Domain modelling, lineage, and warehouse design built for AI workloads. The foundation enterprise AI programs keep skipping.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "AI Agent Development",
      description:
        "Working AI systems deployed to your stack and owned by your team. Real delivery against a program goal, not a demo against a favourable dataset.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "AI & Data Training",
      description:
        "Hands-on workshops for data and AI teams across the Anthropic ecosystem: Claude Code, Claude Cowork, and production AI agent development. Working knowledge teams can apply the next day.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
  ];
}

// WebPage JSON-LD for Pages-CMS-served URLs. Built per-page from the
// row in the `page` table. dateModified is the signal Google + LLM
// citation graphs pick up to surface "this is the current version of
// the Privacy Policy" in answers — important for legal documents.
type SchemaWebPage = {
  "@context": "https://schema.org";
  "@type": "WebPage";
  name: string;
  description: string;
  url: string;
  inLanguage: string;
  isPartOf: { "@type": "WebSite"; name: string; url: string };
  publisher: { "@type": "Organization"; name: string; url: string };
  datePublished?: string;
  dateModified?: string;
};

export function buildCmsPageWebPageLd(args: {
  title: string;
  description: string;
  url: string;
  orgName: string;
  siteUrl: string;
  datePublishedISO?: string;
  dateModifiedISO?: string;
}): SchemaWebPage {
  const ld: SchemaWebPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: args.title,
    description: args.description,
    url: args.url,
    inLanguage: "en-AU",
    isPartOf: {
      "@type": "WebSite",
      name: args.orgName,
      url: args.siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: args.orgName,
      url: args.siteUrl,
    },
  };
  if (args.datePublishedISO) ld.datePublished = args.datePublishedISO;
  if (args.dateModifiedISO) ld.dateModified = args.dateModifiedISO;
  return ld;
}
