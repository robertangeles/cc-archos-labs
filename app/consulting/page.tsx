// Consulting page — May 2026 SMB rewrite. This is the closing surface:
// the home positions, /about builds trust, /consulting answers the four
// questions a ready-to-buy visitor has — what do I get, how does it
// work, what does it cost, how do I start.
//
// One-person practice. "I" voice throughout. No "we" language.
//
// Composed from the home section components (Hero, Section, CtaPair,
// ServiceCard, Timeline, ObjectionFaq, StickyMobileCta). The pricing
// signal tiles are inlined — three short blocks under one Section. No
// dollar amounts on this page per CLAUDE.md (pricing happens in
// conversation; the page surfaces engagement *shape*).
//
// Why a static route instead of a CMS page: home + /about + /consulting
// are the three core marketing surfaces and they share the same
// component vocabulary. Editing them is a code change, not a content
// change. 'consulting' is in RESERVED_SLUGS so the [...slug] catch-all
// won't shadow this route.

import type { Metadata } from "next";
import { buildPageMetadata, getSiteUrl } from "../../lib/site-config";
import { buildConsultingLd } from "../../lib/schema-org";
import { jsonLdScript } from "../../lib/structured-data";
import { BOOK_A_CALL_URL, TAKE_ASSESSMENT_URL } from "../../lib/cta-urls";
import { sanitiseName } from "../../lib/sanitise-name";
import { AnalyticsClient } from "../../components/analytics/analytics-client";
import {
  Hero,
  Section,
  CtaPair,
  ServiceCard,
  Timeline,
  ObjectionFaq,
  StickyMobileCta,
} from "../../components/sections/home";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    // Brand-free: the layout template appends " — Archos Labs" (see app/page.tsx).
    title: "Fractional Data & AI Consulting for Startups",
    description:
      "Fractional data leadership, short-term gigs, and AI readiness diagnostics for startups and SMBs. Fixed-fee. No retainer. Melbourne, Australia.",
    path: "/consulting",
  });
}

const ASSESSMENT_CTA = {
  label: "Take the assessment",
  href: TAKE_ASSESSMENT_URL,
  microcopy: "8 min · no login required",
};

const BOOK_CALL_CTA = {
  label: "Book a call",
  href: BOOK_A_CALL_URL,
  microcopy: "30 min · I'll tell you if it's not a fit",
};

const DIAGNOSTIC_CTA = {
  label: "Take the diagnostic",
  href: TAKE_ASSESSMENT_URL,
  microcopy: "8 min · no login required",
};

const SERVICES = [
  {
    deliverable: "Ongoing",
    name: "Fractional Data Leadership",
    body:
      "Part-time, ongoing work as your senior data person. Architecture decisions, governance, someone to call when something breaks — without the full-time salary. You get senior expertise for the hours you actually need.",
    bestFor:
      "Startups and SMBs that need ongoing data support but can't justify a full-time hire.",
  },
  {
    deliverable: "3–6 Months",
    name: "Short-Term Gigs",
    body:
      "Specific problem. Fixed scope. Fixed fee. I go in, do the work, and hand it back. Data model for a new product. Warehouse that needs cleaning. AI pipeline that isn't working. One problem, solved.",
    bestFor: "Teams with a specific data or AI project that needs to ship.",
  },
  {
    deliverable: "8 Minutes",
    name: "AI Readiness Diagnostic",
    body:
      "Before you build on AI, you need to know what's underneath it. The diagnostic tells you exactly where your data will break your AI project — before you spend more money finding out the hard way. No login. Written report.",
    bestFor:
      "Founders about to build on AI who need to know what they're walking into.",
    cta: { label: "Take the diagnostic", href: TAKE_ASSESSMENT_URL },
  },
  {
    deliverable: "Half or Full Day",
    name: "AI & Data Workshops",
    body:
      "Hands-on sessions for your team. Real constraints. Real tools. We work through your actual data problems, not generic examples. Your team leaves knowing what to build and what to avoid.",
    bestFor:
      "Small teams that need to understand data and AI before they commit to a build.",
  },
];

const TIMELINE_STEPS = [
  {
    week: "Step 1",
    label: "Take the diagnostic",
    description: "8 minutes. No login. You get a written report.",
  },
  {
    week: "Step 2",
    label: "30-minute call",
    description:
      "If the diagnostic flags issues, I'll invite you to a call. Fit check. No pitch.",
  },
  {
    week: "Step 3",
    label: "Scoped proposal",
    description:
      "I send a written scope and fixed fee within 48 hours. You see the number before anything starts.",
  },
  {
    week: "Step 4",
    label: "Work begins",
    description: "Same person throughout. No handoff. No junior team.",
  },
  {
    week: "Step 5",
    label: "Handback",
    description:
      "You own everything. I document it so your team can maintain it without me.",
  },
];

const PROOF_STRIP = [
  { figure: "3 months", detail: "COBOL lineage delivered" },
  { figure: "7 days", detail: "AI model shipped" },
  { figure: "25 years", detail: "Cross-industry delivery" },
];

const PRICING_TILES = [
  {
    label: "Diagnostic",
    price: "Fixed fee",
    note: "Written report. CFO-ready output. Standalone deliverable.",
  },
  {
    label: "Short-term gig",
    price: "Fixed fee · scoped per project",
    note: "Scope defined upfront. Number agreed before work starts. Does not move.",
  },
  {
    label: "Fractional",
    price: "Monthly · fixed hours",
    note: "Agreed hours per month. Same rate each month. Cancel with 30 days notice.",
  },
];

const OBJECTIONS = [
  {
    question: "What does this actually cost?",
    answer: [
      "Every engagement is scoped and fixed before work starts. I don't bill by the hour. I don't send invoices that grow as the engagement does. You see the number before we begin and it doesn't move.",
      "For specific pricing, take the diagnostic or book a call. I'll send a written scope within 48 hours of our conversation.",
    ],
  },
  {
    question: "You're one person. What if something goes wrong?",
    answer: [
      "The same thing that happens at a large firm — except you know exactly who is accountable. There's no escalation path because there's no one to escalate past. I took your call. I ran the diagnostic. I do the work.",
    ],
  },
  {
    question: "How is fractional different from hiring a contractor?",
    answer: [
      "A contractor works full-time on one engagement. Fractional means you get senior expertise across the hours you actually need — not a full-time salary for a part-time problem. And you're not managing someone's employment.",
    ],
  },
  {
    question: "I'm early-stage. Is this relevant for me?",
    answer: [
      "Probably. Founders who sort the data foundation early spend less fixing it later. The diagnostic will tell you what's actually relevant for your stage — and whether it's worth acting on now or in six months.",
    ],
  },
  {
    question: "How quickly can we start?",
    answer: [
      "The diagnostic is immediate. A 30-minute call can usually happen within a week. Scoped engagements start within two weeks of the proposal being agreed.",
    ],
  },
  {
    question: "What if we just need one specific thing done?",
    answer: [
      "That's a gig. Tell me what it is on the call. I'll scope it, fix a fee, do the work, and hand it back. Clean start, clean finish.",
    ],
  },
];

type ConsultingSearchParams = Promise<{
  name?: string | string[];
}>;

export default async function ConsultingPage({
  searchParams,
}: {
  searchParams: ConsultingSearchParams;
}) {
  const { name } = await searchParams;
  const rawName = Array.isArray(name) ? name[0] : name;
  const sanitisedName = sanitiseName(rawName);

  const preparedOn = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Built from the SERVICES and OBJECTIONS constants this page already renders,
  // so the FAQ answers Google reads are literally the ones on screen. An
  // FAQPage whose content is not visible on the page is a structured-data
  // policy violation, and a second hardcoded copy would drift the first time
  // someone edits the visible copy alone.
  const consultingLd = buildConsultingLd({
    services: SERVICES,
    faqs: OBJECTIONS,
    url: `${getSiteUrl()}/consulting`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(consultingLd) }}
      />

      <AnalyticsClient route="/consulting" />

      <main className="flex flex-1 flex-col">
        {sanitisedName ? (
          <div className="print-only border-b border-hairline">
            <div className="mx-auto max-w-[1080px] px-6 py-4 md:px-12">
              <p className="text-eyebrow uppercase text-ink-subtle">
                Prepared for {sanitisedName} · Prepared on {preparedOn}
              </p>
            </div>
          </div>
        ) : null}

        {/* 1. Hero */}
        <Hero
          eyebrow="Fractional Data · Short-Term Gigs · AI Readiness"
          gradient="off"
          headline={
            <>
              No data team?
              <span className="block">I am your data team.</span>
            </>
          }
          subhead={
            <span className="mx-auto block max-w-[520px]">
              Fractional data leadership and short-term gigs for founders
              and small teams. Fixed-fee. Scoped before we start.
              Delivered by the same person you spoke to.
            </span>
          }
          cta={{
            primary: ASSESSMENT_CTA,
            secondary: BOOK_CALL_CTA,
            position: "hero",
          }}
        />

        {/* Proof strip — horizontal credibility anchor between hero and
            services. Three numbers from the About page, compressed. */}
        <section
          aria-label="Proof"
          className="border-y border-hairline bg-surface-1"
        >
          <dl className="mx-auto grid max-w-[1080px] gap-8 px-6 py-12 md:grid-cols-3 md:gap-12 md:px-12">
            {PROOF_STRIP.map((p) => (
              <div
                key={p.figure}
                className="flex flex-col items-start gap-2 md:items-center md:text-center"
              >
                <dt className="text-display-md text-ink md:text-display-lg">
                  {p.figure}
                </dt>
                <dd className="text-body text-ink-subtle">{p.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 2. Services — 2x2 grid. Canvas so it alternates against the
            proof strip above. */}
        <Section id="services" bg="canvas" pad="section">
          <h2 className="text-center text-display-md text-ink">
            What I offer.
          </h2>
          <div className="mt-12 grid items-stretch gap-6 md:grid-cols-2 md:gap-8">
            {SERVICES.map((service) => (
              <ServiceCard
                key={service.name}
                deliverable={service.deliverable}
                name={service.name}
                body={service.body}
                bestFor={service.bestFor}
                cta={"cta" in service ? service.cta : undefined}
              />
            ))}
          </div>
        </Section>

        {/* 3. How Engagements Work — timeline with per-step descriptions */}
        <Section id="how-it-works" bg="bordered" pad="section">
          <h2 className="text-center text-display-md text-ink">
            How it works.
          </h2>
          <Timeline milestones={TIMELINE_STEPS} />
        </Section>

        {/* 4. Pricing — three engagement-type signal tiles, NO dollar amounts */}
        <Section id="pricing" bg="canvas" pad="section">
          <div className="text-center">
            <h2 className="text-display-md text-ink">How I price.</h2>
            <p className="mx-auto mt-5 max-w-[520px] text-body text-ink-muted">
              Every engagement is scoped and fixed before work begins. No
              retainers. No hourly billing. No invoice that grows.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3 md:gap-8">
            {PRICING_TILES.map((tile) => (
              <div
                key={tile.label}
                className="flex flex-col gap-5 rounded-lg border border-hairline bg-surface-1 p-10 transition-colors duration-200 hover:border-hairline-strong hover:bg-surface-2 md:p-12"
              >
                <p className="text-eyebrow uppercase text-ink-subtle">
                  {tile.label}
                </p>
                <p className="text-headline text-ink md:text-display-md">
                  {tile.price}
                </p>
                <p className="mt-auto border-t border-hairline pt-6 text-body text-ink-muted">
                  {tile.note}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* 5. FAQ */}
        <Section id="faq" bg="bordered" pad="section">
          <h2 className="text-center text-display-md text-ink">
            Common questions.
          </h2>
          <div className="mx-auto mt-8 max-w-[760px]">
            <ObjectionFaq items={OBJECTIONS} />
          </div>
        </Section>

        {/* 6. Final CTA */}
        <Section id="final-cta" bg="canvas" pad="section" centered>
          <h2 className="text-display-md text-ink">
            Start with the diagnostic.
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-body-lg text-ink-muted">
            8 minutes. No login. You get a written report that tells you
            exactly where your data will break your AI project. If
            we&rsquo;re a fit, I&rsquo;ll invite you to a 30-minute call.
          </p>
          <div className="mt-12">
            <CtaPair
              primary={DIAGNOSTIC_CTA}
              secondary={BOOK_CALL_CTA}
              position="final"
            />
          </div>
        </Section>
      </main>

      <StickyMobileCta
        primary={{
          label: "Take the diagnostic",
          href: TAKE_ASSESSMENT_URL,
        }}
        secondary={{
          label: "Book a call",
          href: BOOK_A_CALL_URL,
        }}
        hideWhenSelector="#final-cta"
      />
    </>
  );
}
