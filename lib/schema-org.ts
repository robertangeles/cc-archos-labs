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
      name: "Fractional Data Leadership",
      description:
        "Part-time, ongoing senior data person for startups and SMBs. Architecture, governance, and a senior data hand to call when something breaks — without the full-time salary.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Short-Term Data Gigs",
      description:
        "Fixed-scope, fixed-fee data work: cleanup, modelling, lineage, or a specific AI integration. In, done, handed back.",
      provider: { "@type": "Organization", name: orgName },
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "AI Readiness Diagnostic",
      description:
        "Eight-minute diagnostic that tells founders exactly where their data will break their AI project. No login. Written report.",
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

export function buildCdmpPracticeExamLd(args: {
  orgName: string;
  siteUrl: string;
}) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "CDMP Practice Exam",
      description:
        "Free practice exam for the CDMP Fundamentals certification by DAMA International. AI-generated questions from DMBOK content, scored against real exam chapter weightings. 14 knowledge areas, 100 questions, 90 minutes.",
      url: `${args.siteUrl}/tools/cdmp-practice`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web browser",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free for early adopters",
      },
      provider: {
        "@type": "Organization",
        name: args.orgName,
        url: args.siteUrl,
      },
      audience: {
        "@type": "EducationalAudience",
        educationalRole: "Professional",
        audienceType: "Data professionals preparing for CDMP certification",
      },
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is the CDMP Fundamentals exam format?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The CDMP Fundamentals exam is 100 multiple-choice questions with 5 answer choices each, completed in 90 minutes. It is open book (one book only). The exam costs $311 USD per attempt.",
          },
        },
        {
          "@type": "Question",
          name: "What are the CDMP certification levels?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "There are three levels: Associate (60% pass), Practitioner (70% pass + 2 specialist exams), and Master (80% pass + 2 specialist exams + experience).",
          },
        },
        {
          "@type": "Question",
          name: "How many DMBOK knowledge areas does the CDMP exam cover?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The CDMP Fundamentals exam covers 14 topics: 11 knowledge areas (Data Governance, Data Quality, Data Modelling, Metadata Management, Master & Reference Data, Data Warehousing & BI, Data Architecture, Data Storage, Data Security, Data Integration, Document & Content Management) plus Data Management Process, Data Ethics, and Big Data.",
          },
        },
        {
          "@type": "Question",
          name: "Is this CDMP practice exam free?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. The practice exam is free for early adopters. Sign up during the first 3 months and it stays free for you forever.",
          },
        },
      ],
    },
  ];
}
