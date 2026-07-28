// Schema.org JSON-LD for surfaces that need page-specific structured data.
//
// The Organization, founder Person, Metis and WebSite nodes are DECLARED once
// in app/layout.tsx's @graph. Everything here REFERENCES them by @id via
// lib/schema-graph.ts rather than re-declaring its own copy — that is what
// stops Google resolving one organisation per page that mentions it.
//
// Consumers:
//   - app/page.tsx        → buildHomePageServicesLd  (three Service entities)
//   - app/about/page.tsx  → buildAboutPagePersonLd   (merges into #rob-angeles)
//   - app/[...slug]       → buildCmsPageWebPageLd    (WebPage per CMS row)
//   - /tools/cdmp-practice→ buildCdmpPracticeExamLd  (WebApplication + FAQPage)
//   - app/consulting      → buildConsultingLd        (Service + FAQPage)
//
// Per CLAUDE.md we never publish prices, so the consulting Service entities
// carry no Offer. Service.areaServed signals Australia coverage for AIEO
// queries like "AI consultants in Australia" without committing to
// LocalBusiness semantics (which Organization already covers via address).
//
// Copy here is static, but `siteUrl` and anything sourced from site_setting is
// admin-editable — every consumer must serialise through jsonLdScript().

import { FOUNDER_JOB_TITLE, ref, SCHEMA_IDS } from "./schema-graph";

type SchemaService = {
  "@context": "https://schema.org";
  "@type": "Service";
  name: string;
  description: string;
  provider: { "@id": string };
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
  /** Same id the layout graph declares, so this MERGES into that node
   *  instead of introducing a second person with the same name. */
  "@id": string;
  name: string;
  jobTitle: string;
  worksFor: { "@id": string };
  url: string;
  knowsAbout: string[];
  sameAs?: string[];
};

export function buildAboutPagePersonLd(args: {
  founderName: string;
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
    "@id": SCHEMA_IDS.person,
    name: args.founderName,
    // One title across the whole site — see lib/schema-graph.ts. This node and
    // the layout's share an @id, so two different values here would be
    // contradictory claims about a single entity rather than two opinions.
    jobTitle: FOUNDER_JOB_TITLE,
    worksFor: ref(SCHEMA_IDS.org),
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

export function buildHomePageServicesLd(): SchemaService[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Fractional Data Leadership",
      description:
        "Part-time, ongoing senior data person for startups and SMBs. Architecture, governance, and a senior data hand to call when something breaks — without the full-time salary.",
      provider: ref(SCHEMA_IDS.org),
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Short-Term Data Gigs",
      description:
        "Fixed-scope, fixed-fee data work: cleanup, modelling, lineage, or a specific AI integration. In, done, handed back.",
      provider: ref(SCHEMA_IDS.org),
      areaServed: { "@type": "Country", name: "Australia" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "AI Readiness Diagnostic",
      description:
        "Eight-minute diagnostic that tells founders exactly where their data will break their AI project. No login. Written report.",
      provider: ref(SCHEMA_IDS.org),
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
  isPartOf: { "@id": string };
  publisher: { "@id": string };
  datePublished?: string;
  dateModified?: string;
};

export function buildCmsPageWebPageLd(args: {
  title: string;
  description: string;
  url: string;
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
    isPartOf: ref(SCHEMA_IDS.website),
    publisher: ref(SCHEMA_IDS.org),
  };
  if (args.datePublishedISO) ld.datePublished = args.datePublishedISO;
  if (args.dateModifiedISO) ld.dateModified = args.dateModifiedISO;
  return ld;
}

/**
 * Service + FAQPage for /consulting — the page a ready-to-buy visitor lands on,
 * which carried no structured data at all.
 *
 * Both arrays are the SAME constants the page renders, passed in rather than
 * restated here. An FAQPage whose answers do not appear on the page is a
 * Google structured-data violation, and a second hardcoded copy would drift
 * away from the visible copy the first time someone edits one and not the other.
 *
 * No Offer and no price on the Service entities — CLAUDE.md forbids publishing
 * rates, and the page itself only says pricing is fixed and scoped up front.
 */
export function buildConsultingLd(args: {
  services: ReadonlyArray<{ name: string; body: string }>;
  faqs: ReadonlyArray<{ question: string; answer: readonly string[] }>;
  url: string;
}) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": args.url,
      name: "Fractional Data & AI Consulting",
      url: args.url,
      inLanguage: "en-AU",
      isPartOf: ref(SCHEMA_IDS.website),
      publisher: ref(SCHEMA_IDS.org),
      about: ref(SCHEMA_IDS.org),
    },
    ...args.services.map((s) => ({
      "@context": "https://schema.org",
      "@type": "Service",
      name: s.name,
      description: s.body,
      provider: ref(SCHEMA_IDS.org),
      areaServed: { "@type": "Country", name: "Australia" },
    })),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: args.faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: {
          "@type": "Answer",
          // Paragraphs are rendered as separate <p> elements; join them so the
          // answer text matches what a reader sees, whitespace aside.
          text: f.answer.join(" "),
        },
      })),
    },
  ];
}

export function buildCdmpPracticeExamLd(args: { siteUrl: string }) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "CDMP Practice Exam",
      description:
        "Free practice exams for the CDMP certification. Questions follow the same format, depth, and chapter weightings as the official exam. 14 knowledge areas, 100 questions, 90 minutes.",
      url: `${args.siteUrl}/tools/cdmp-practice`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web browser",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
        description: "Free for early adopters",
      },
      provider: ref(SCHEMA_IDS.org),
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
