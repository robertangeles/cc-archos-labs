// Home page — May 2026 PAS rewrite. Composed from section components in
// components/sections/home/. See wiki/decisions/2026-05-17-home-page-pas-rewrite.md
// for the locked decisions (industries, hero copy, proof framing, accepted
// expansions). The 4-section May 7 home page is superseded by this layout.
//
// Order of sections matches the PAS structure with three accepted expansions
// woven into the flow: 90-day timeline between Solution+Proof and Services,
// objection FAQ between Services and Who We Work With, anchor nav under the
// hero (desktop only), sticky mobile CTA bar across the page (hides on
// Final CTA).
//
// Server Component. Reads ?name= URL param server-side for the optional
// print personalisation header. All user input goes through
// `lib/sanitise-name.ts`; React's default escaping handles rendering.

import { getSiteSettings } from "../lib/site-config";
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

// Copy lives as data so it's reviewable as a single block and easy to retune.
const ASSESSMENT_CTA = {
  label: "Take the assessment",
  href: TAKE_ASSESSMENT_URL,
  microcopy: "8 min · no login required",
};

const BOOK_CALL_CTA = {
  label: "Book a call",
  href: BOOK_A_CALL_URL,
  microcopy: "30 min · we'll tell you if it's not a fit",
};

const PROOF_POINTS = [
  {
    label: "Major health insurer",
    outcome:
      "We built an AI agent that reads COBOL source code, extracts the business rules and logic, routes them to SMEs for review, documents the validated rules, and outputs a data model with full metadata ready for implementation. No manual reconstruction. No knowledge lost in translation.",
  },
  {
    label: "25 years · cross-industry delivery",
    outcome:
      "Every sector. The same problems. Data no one trusts, SMEs who hold the knowledge but have never been structured, and stakeholders who cannot say yes to something they cannot see. We go in, run the workshops, build the models, and give your board something defensible.",
  },
  {
    label: "Sovereign AI on consumer hardware",
    outcome:
      "When the consensus was that a fine-tuned AI model could not run offline on a $300 Android phone, we built one. It shipped in 7 days. The model runs fully offline on budget Android hardware, no server required. We're not the first, but one of the very few in Australia who have shipped this.",
  },
];

const TIMELINE_MILESTONES = [
  { week: "Week 0", label: "Assessment" },
  { week: "Week 1", label: "30-minute call" },
  { week: "Week 2", label: "Written diagnostic" },
  { week: "Week 4", label: "Scoped engagement" },
  { week: "Week 12", label: "Working system" },
];

const SERVICES = [
  {
    name: "AI Readiness Assessment",
    deliverable: "Written Assessment",
    body:
      "Two weeks. We map your data foundation, governance, and AI surface area against what your program actually needs. You get a written document your CFO or board can act on, not a framework, not a slide deck. It tells you what is ready, what is not, and what fixing it costs. Most clients use it to unblock a business case that has been stalled for months.",
  },
  {
    name: "Data Architecture",
    deliverable: "Data Foundation",
    body:
      "A model is only as good as the data underneath it. We design and build the lineage, domain models, and warehouse structures your AI workloads need to run in production, not in demo conditions. Business rules extracted, documented, and traceable. A foundation your CFO can defend and your team can maintain.",
  },
  {
    name: "AI Agent Development",
    deliverable: "Production System",
    body:
      "Working systems, deployed to your stack, owned by your team. We build AI agents that solve a specific program problem, not proofs of concept that never leave the sandbox. We have built agents that replaced months of manual work in weeks. The deliverable is a system in production, not a slide about one.",
  },
  {
    name: "AI & Data Training",
    deliverable: "Team Workshops",
    body:
      "Most teams know AI is coming. Few know how to work with it at the data layer. We run hands-on workshops for data and AI teams across the Anthropic ecosystem: Claude Code, Claude Cowork, and production AI agent development. Your team leaves with working knowledge they can apply the next day. Not slide notes. Not a certificate. Capability.",
  },
];

const OBJECTIONS = [
  {
    question: "We already tried this and it failed.",
    answer: [
      "Most programs fail for the same reason. The data foundation was not ready when the model arrived. Nobody said that clearly enough before the program started, the business case was approved on optimistic assumptions, and the failure was attributed to the technology rather than the infrastructure underneath it.",
      "We start at the data layer before anything else is touched. The AI Readiness Assessment exists specifically to surface what will kill your program before it does. If the foundation is not ready, we tell you that in writing, along with exactly what it would take to fix it.",
    ],
  },
  {
    question: "How long before we see something?",
    answer: [
      "Two weeks. The AI Readiness Assessment produces a written document your CFO or board can interrogate. It maps your data foundation, governance posture, and AI surface area against what your program actually needs. It tells you what is ready, what is not, and what fixing it would cost. That is a real deliverable, not a slide deck with a recommended next engagement.",
      "Everything after that is scoped from the assessment output. You know what you are buying before you buy it.",
    ],
  },
  {
    question: "What does this cost?",
    answer: [
      "Engagements are scoped and fixed before work begins. No retainers. No billing for access. No invoice that grows as the engagement does. You see the number before we start and it does not move.",
      "We do not take on engagements we cannot deliver. If the assessment tells us your program needs something outside our scope, we will say so on the call.",
    ],
  },
  {
    question: "Why not just use our existing team?",
    answer: [
      "Your team knows the domain. We know what breaks AI programs at the data layer, and we have fixed it across healthcare, financial services, government, and retail. Those are not the same things.",
      "We work alongside your team. We bring lineage mapping, governance frameworks, data architecture, and AI agent development. We transfer the knowledge. We hand it back when it is done. Your team owns it.",
    ],
  },
  {
    question: "Why not a large firm?",
    answer: [
      "Large firms bring the right name to the pitch and a different team to the delivery. A senior partner closes the engagement. A junior consultant runs it. You pay senior-partner rates for both.",
      "We bring the same person to the assessment, the architecture, and the delivery. No handoff. No translation layer between the person who understood your problem and the person executing the fix. What we sell is what shows up.",
    ],
  },
  {
    question: "What if our data is in COBOL or on legacy systems?",
    answer: [
      "That is a large part of what we do. Legacy systems hold the business logic your organisation runs on and nobody has documented it properly in decades. We built an AI agent at a major health insurer that reads COBOL source code, extracts the business rules and logic, routes them through SME review, documents the validated rules, and outputs a data model ready for implementation on the new platform. The team estimated 6 to 9 months manually. We delivered it in 3.",
      "If your program is blocked by legacy complexity, that is not a reason to wait. It is the reason to call.",
    ],
  },
];

const BUILT_FOR = [
  "Programs that have stalled and need someone to say clearly what is wrong, not what the client wants to hear.",
  "Executives who have sat through enough vendor presentations to know the gap between a demo and a working system.",
  "Organisations in financial services, healthcare, government, and retail where a failed AI program does not just lose budget, it loses trust.",
  "Teams who need the work done, not managed.",
];

const NOT_FOR = [
  "Programs looking to validate a decision already made.",
  "Organisations that want a brand name on the engagement more than a working outcome.",
  "Teams not yet ready to hear that the data problem comes before the AI problem.",
];

const ANCHOR_NAV_ITEMS = [
  { label: "Services", href: "#services" },
  { label: "Proof", href: "#proof" },
  { label: "Assessment", href: "#assessment" },
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

        <Hero
          eyebrow="Data and AI Transformation Practice"
          headline={
            <>
              Most AI programs <span className="text-primary">fail</span> at the
              data layer.
              <span className="mt-4 block text-ink-muted md:text-display-lg">
                By the time anyone admits it, the budget is gone.
              </span>
            </>
          }
          subhead={
            <>
              We go into programs in financial services, healthcare, government,
              and retail that are stuck or at risk.{" "}
              <br className="hidden md:inline" />
              We fix the data foundation. Then we get the program moving.
            </>
          }
          cta={{
            primary: ASSESSMENT_CTA,
            secondary: BOOK_CALL_CTA,
            position: "hero",
          }}
          anchorNav={{ items: ANCHOR_NAV_ITEMS }}
        />

        {/* Agitate */}
        <Section bg="surface-1">
          <h2 className="text-display-md text-ink">
            The longer it stays stuck, the more it costs you.
          </h2>
          <div className="mt-8 space-y-6 text-body-lg text-ink-subtle">
            <p>
              The vendor is not going to tell you. The model performs in demo
              conditions. Your data team knows there are problems but is not in
              the room when commitments are made. Your executive sponsor
              approved a business case built on assumptions your data
              infrastructure cannot support.
            </p>
            <p>
              When the program stalls, and programs built on weak data
              foundations do stall, it will not be attributed to the vendor.
              It will be attributed to the decision to proceed. That decision
              has a name on it.
            </p>
            <p>
              The organisations that fix this know something the others do not.
              The model was never the constraint.
            </p>
          </div>
        </Section>

        {/* Solution + Proof */}
        <Section id="proof" bg="canvas">
          <h2 className="text-display-md text-ink">
            We go in and fix what is broken.
          </h2>
          <div className="mt-8 space-y-6 text-body-lg text-ink-subtle">
            <p>
              Archos Labs is not a vendor. We are the person your vendor
              should have sent. We go into programs that are stuck or at risk
              in financial services, healthcare, government, and retail and
              fix what is broken. We are practitioners who have built these
              systems, not consultants who have read about them.
            </p>
            <p>
              We don&rsquo;t take retainers. We don&rsquo;t pad timelines. We
              don&rsquo;t bring 12-person teams to your meetings.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-10">
            {PROOF_POINTS.map((proof) => (
              <ProofItem
                key={proof.label}
                label={proof.label}
                outcome={proof.outcome}
              />
            ))}
          </div>
        </Section>

        {/* 90-day timeline */}
        <Section bg="surface-1">
          <h2 className="text-display-md text-ink">
            From assessment to working system in twelve weeks.
          </h2>
          <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
            The path most programs take. We compress it.
          </p>
          <Timeline milestones={TIMELINE_MILESTONES} />
        </Section>

        {/* Services */}
        <Section id="services" bg="canvas">
          <h2 className="text-display-md text-ink">How we work with you.</h2>
          <div className="mt-12 grid items-stretch gap-6 md:grid-cols-2 md:gap-8">
            {SERVICES.map((service, i) => (
              <ServiceCard
                key={service.name}
                index={i + 1}
                total={SERVICES.length}
                deliverable={service.deliverable}
                name={service.name}
                body={service.body}
              />
            ))}
          </div>
        </Section>

        {/* Objection FAQ */}
        <Section bg="surface-1">
          <h2 className="text-display-md text-ink">Common questions.</h2>
          <div className="mt-2">
            <ObjectionFaq items={OBJECTIONS} />
          </div>
        </Section>

        {/* Who We Work With */}
        <Section bg="canvas">
          <h2 className="text-display-md text-ink">Who we work with.</h2>
          <p className="mt-5 text-body-lg text-ink-subtle">
            We take on a small number of engagements. This is who they are
            right for.
          </p>
          <div className="mt-12 grid gap-12 md:grid-cols-2">
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

        {/* Assessment Block — elevated surface to signal a distinct moment */}
        <Section id="assessment" bg="elevated">
          <h2 className="text-display-md text-ink">
            Start with the assessment.
          </h2>
          <div className="mt-6 space-y-5 text-body-lg text-ink-subtle">
            <p>
              It takes 8 minutes. It tells you where your program is exposed
              across data foundation, governance, and program readiness. You
              get a written report. If the score tells us we are the right
              fit, we will invite you to a 30-minute call.
            </p>
            <p>Not everyone gets the call. That is the point.</p>
          </div>
          <div className="mt-10">
            <CtaPair primary={ASSESSMENT_CTA} position="assessment-block" />
          </div>
        </Section>

        {/* Final CTA */}
        <Section id="final-cta" bg="bordered" pad="relaxed" centered>
          <h2 className="text-headline text-ink md:text-display-md">
            One call. Thirty minutes.
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-body text-ink-subtle">
            Tell us what is broken. We&rsquo;ll tell you whether it is a problem
            we have solved before and what fixing it would cost. No deck or
            qualification process. If we can&rsquo;t help, we&rsquo;ll say so.
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
