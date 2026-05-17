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
