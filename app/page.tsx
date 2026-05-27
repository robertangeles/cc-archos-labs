// Home page — May 2026 SMB rewrite. Positioning: "You don't have a data
// team. I am your data team." Target buyer is startup founders and SMB
// operators with no dedicated data person — NOT enterprise programs.
// Composed from section components in components/sections/home/.
//
// Eight sections, alternating canvas / surface-1, 96px vertical rhythm
// per DESIGN.md. No atmospheric gradients. No pill buttons. Lavender is
// the only accent and appears only on primary CTAs and the lavender
// strokes on cards.
//
// Server Component. Reads ?name= URL param server-side for the optional
// print personalisation header. All user input goes through
// `lib/sanitise-name.ts`; React's default escaping handles rendering.

import type { Metadata } from "next";
import { getSiteSettings, buildPageMetadata } from "../lib/site-config";
import { BOOK_A_CALL_URL, TAKE_ASSESSMENT_URL } from "../lib/cta-urls";
import { buildHomePageServicesLd } from "../lib/schema-org";
import { sanitiseName } from "../lib/sanitise-name";
import { AnalyticsClient } from "../components/analytics/analytics-client";
import {
  Hero,
  Section,
  CtaPair,
  ProofItem,
  ServiceCard,
  AudienceList,
  Timeline,
  ObjectionFaq,
  StickyMobileCta,
} from "../components/sections/home";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title:
      "Archos Labs — Your Fractional Data Team | Startups & SMBs",
    description:
      "No data team? Rob Angeles works with startup founders and SMBs as their fractional data person. Fixed-fee. No retainer. Melbourne, Australia.",
    path: "/",
  });
}

// Copy lives as data so it's reviewable as a single block and easy to retune.
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

const STATS = [
  {
    figure: "3 months",
    detail: "COBOL lineage delivered. Estimate was 6–9.",
  },
  {
    figure: "7 days",
    detail: "AI model shipped. Fully offline. $300 hardware.",
  },
  {
    figure: "25 years",
    detail: "Cross-industry data and AI delivery.",
  },
];

const SERVICES = [
  {
    deliverable: "Ongoing",
    name: "Fractional Data Leadership",
    body:
      "Part-time, ongoing work as your senior data person. Architecture decisions, governance, and someone to call when something breaks — without the full-time salary.",
    bestFor: "Startups and SMBs that need ongoing data support.",
  },
  {
    deliverable: "3–6 Months",
    name: "Short-Term Gigs",
    body:
      "Specific problem. Fixed scope. Fixed fee. Need your data cleaned up before you build on it? Need a data model for a new product? I go in, do the work, hand it back, done.",
    bestFor: "Teams with a specific data or AI project to ship.",
  },
  {
    deliverable: "8 Minutes",
    name: "AI Readiness Diagnostic",
    body:
      "Tells you exactly where your data will break your AI project before you spend more money finding out the hard way. No login. You get a written report.",
    bestFor: "Founders about to build on AI.",
  },
];

const PROOF_POINTS = [
  {
    eyebrow: "Legacy systems",
    title: "COBOL to clean data model.",
    body:
      "Built an AI agent that reads legacy source code, extracts business rules, and outputs a data model ready for implementation. No manual reconstruction.",
    stat: "3 months  ·  estimate was 6–9",
  },
  {
    eyebrow: "Sovereign AI",
    title: "Fine-tuned model. Offline. $300 phone.",
    body:
      "Shipped a fine-tuned AI model running fully offline on budget Android hardware. The consensus was it couldn't be done.",
    stat: "7 days  ·  scoping to shipped",
  },
  {
    eyebrow: "Platform migration",
    title: "12-month migration delivered in 6.",
    body:
      "Business-rule fidelity preserved end-to-end. The data foundation work done upfront so the platform work could run clean.",
    stat: "6 months  ·  half the original timeline",
  },
];

const TIMELINE_MILESTONES = [
  { week: "Step 1", label: "Take the 8-minute assessment" },
  { week: "Step 2", label: "Get your written report" },
  { week: "Step 3", label: "30-minute call if we're a fit" },
  { week: "Step 4", label: "Scope the work — fractional or gig" },
  { week: "Step 5", label: "Work starts. Same person throughout." },
];

const OBJECTIONS = [
  {
    question:
      "I'm not sure I have a data problem. How do I know if I need this?",
    answer: [
      "Take the assessment. 8 minutes. It tells you what's there and what's missing. If everything is fine, you'll know that too.",
    ],
  },
  {
    question: "What does this cost?",
    answer: [
      "Fixed-fee. Scoped before work starts. No retainer. No billing by the hour. You see the number before we begin and it doesn't move.",
    ],
  },
  {
    question: "How is fractional different from hiring someone part-time?",
    answer: [
      "You get 25 years of cross-industry experience for the hours you actually need, not the salary of a junior hire working full-time. And you're not managing an employee.",
    ],
  },
  {
    question: "I'm early-stage. Is this too soon?",
    answer: [
      "Probably not. Founders who get the data foundation right early spend less fixing it later. The assessment will tell you what's actually relevant for your stage.",
    ],
  },
  {
    question: "What if I just need one specific thing done?",
    answer: [
      "That's a gig. We scope it, fix a fee, I do the work, hand it back, and we're done.",
    ],
  },
  {
    question: "What if our data is in old systems or spreadsheets?",
    answer: [
      "That's most of the founders I work with. It's not a blocker. The assessment will tell you what shape it's in and what it would take to make it usable.",
    ],
  },
];

const BUILT_FOR = [
  "Startup founders shipping AI without a data team",
  "SMBs that need data infrastructure but can't hire full time",
  "Technical leads who need a senior data person for a specific build",
  "Founders who want to use AI and need the data underneath it to work",
];

const NOT_FOR = [
  "Large enterprises with existing data departments",
  "Companies looking for a big firm with a brand name",
  "Anyone wanting a 12-month retainer before work starts",
];

const ANCHOR_NAV_ITEMS = [
  { label: "Services", href: "#services" },
  { label: "Proof", href: "#proof" },
  { label: "How it works", href: "#how-it-works" },
];

type HomeSearchParams = Promise<{
  name?: string | string[];
}>;

export default async function Home({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}) {
  const { name } = await searchParams;
  // Coerce array form ("?name=a&name=b") down to a single value before
  // sanitising — only the first is considered.
  const rawName = Array.isArray(name) ? name[0] : name;
  const sanitisedName = sanitiseName(rawName);

  const settings = await getSiteSettings();
  const servicesLd = buildHomePageServicesLd(settings.siteName);

  const preparedOn = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      {/* Page-specific Service JSON-LD. The root Organization + WebSite
          schemas already render globally in app/layout.tsx. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(servicesLd) }}
      />

      <AnalyticsClient route="/" />

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
          eyebrow="Fractional Data · AI Readiness · Short-Term Gigs"
          gradient="off"
          headline={
            <>
              You don&rsquo;t have a data team.
              <span className="mt-4 block text-ink">
                I am your data team.
              </span>
            </>
          }
          subhead={
            <>
              Startups and small businesses building on AI need solid data
              underneath it. Most can&rsquo;t afford a full-time senior data
              hire. I work with founders and technical leads as their
              fractional data person — or on short gigs when you need a
              specific problem solved fast.
            </>
          }
          cta={{
            primary: ASSESSMENT_CTA,
            secondary: BOOK_CALL_CTA,
            position: "hero",
          }}
          trustStrip="25 years  ·  Cross-industry delivery  ·  Melbourne, Australia"
          anchorNav={{ items: ANCHOR_NAV_ITEMS }}
        />

        {/* 2. The Problem — two columns: copy left, stat block right */}
        <Section bg="surface-1" pad="section">
          <div className="grid gap-12 md:grid-cols-2 md:gap-16">
            <div>
              <h2 className="text-display-md text-ink">
                The data problems nobody tells you about until it&rsquo;s too
                late.
              </h2>
              <div className="mt-8 space-y-6 text-body-lg text-ink-muted">
                <p>
                  Your AI tool says it&rsquo;s working. Your numbers don&rsquo;t
                  add up. Nobody on your team knows why. You don&rsquo;t have
                  a data person to ask.
                </p>
                <p>
                  That&rsquo;s the gap. I fill it. Not as a big consulting
                  firm. Not as a vendor. As your data person — the one who
                  knows where things break and how to fix them before they
                  cost you more.
                </p>
              </div>
            </div>
            <dl className="flex flex-col gap-6">
              {STATS.map((s) => (
                <div
                  key={s.figure}
                  className="rounded-lg border border-hairline bg-canvas p-6"
                >
                  <dt className="text-display-md text-ink">{s.figure}</dt>
                  <dd className="mt-2 text-body-sm text-ink-subtle">
                    {s.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>

        {/* 3. What I Do — Services */}
        <Section id="services" bg="canvas" pad="section">
          <h2 className="text-display-md text-ink">
            What &ldquo;I am your data team&rdquo; actually means.
          </h2>
          <div className="mt-12 grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3 md:gap-8">
            {SERVICES.map((service) => (
              <ServiceCard
                key={service.name}
                deliverable={service.deliverable}
                name={service.name}
                body={service.body}
                bestFor={service.bestFor}
              />
            ))}
          </div>
        </Section>

        {/* 4. Proof */}
        <Section id="proof" bg="surface-1" pad="section">
          <h2 className="text-display-md text-ink">Work I&rsquo;ve shipped.</h2>
          <p className="mt-5 max-w-[640px] text-body text-ink-subtle">
            Three examples. Anonymised by request. Specifics on the call.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3 md:gap-8">
            {PROOF_POINTS.map((proof) => (
              <ProofItem
                key={proof.title}
                eyebrow={proof.eyebrow}
                title={proof.title}
                body={proof.body}
                stat={proof.stat}
              />
            ))}
          </div>
        </Section>

        {/* 5. Built For / Not For */}
        <Section bg="canvas" pad="section">
          <div className="grid gap-12 md:grid-cols-2">
            <AudienceList
              variant="built-for"
              heading="Built for"
              items={BUILT_FOR}
            />
            <AudienceList
              variant="not-for"
              heading="Not for"
              items={NOT_FOR}
            />
          </div>
        </Section>

        {/* 6. How It Works — Timeline */}
        <Section id="how-it-works" bg="surface-1" pad="section">
          <h2 className="text-display-md text-ink">
            From first conversation to working system.
          </h2>
          <Timeline milestones={TIMELINE_MILESTONES} />
        </Section>

        {/* 7. FAQ */}
        <Section bg="canvas" pad="section">
          <h2 className="text-display-md text-ink">Common questions.</h2>
          <div className="mt-2">
            <ObjectionFaq items={OBJECTIONS} />
          </div>
        </Section>

        {/* 8. Final CTA */}
        <Section id="final-cta" bg="surface-1" pad="section" centered>
          <h2 className="text-display-md text-ink">
            Start with the assessment.
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-body-lg text-ink-muted">
            8 minutes. No login. You get a written report that tells you
            exactly where your data will break your AI project. If we&rsquo;re
            a fit, I&rsquo;ll invite you to a 30-minute call. No pitch. No
            deck. Just a direct conversation.
          </p>
          <div className="mt-12">
            <CtaPair
              primary={ASSESSMENT_CTA}
              secondary={BOOK_CALL_CTA}
              position="final"
            />
          </div>
        </Section>
      </main>

      <StickyMobileCta
        primary={{
          label: "Take the assessment",
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
