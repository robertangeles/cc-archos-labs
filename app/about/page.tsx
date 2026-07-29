// About page — May 2026 SMB rewrite. Companion to the home page rewrite
// (PR #124). Same positioning: "You don't have a data team. I am your
// data team." The /about page earns that claim — who is this person,
// why are they credible, why would a founder trust them with their data.
//
// One-person practice. "I" throughout. No "we" language.
//
// Composed from the about/ component family (PersonCard, PhilosophyBlock,
// WayOfWorkingSteps) plus reused home primitives (Hero, Section, CtaPair,
// ProofItem, StickyMobileCta). Six sections, 96px rhythm, no atmospheric
// gradients.
//
// Server Component. Reads ?name= URL param server-side for the optional
// print-personalisation header (sanitised via lib/sanitise-name). Photo
// path is a top-of-file constant; lives at /public/images/about-me.png.

import type { Metadata } from "next";
import {
  buildPageMetadata,
  getSiteSettings,
  getSiteUrl,
} from "../../lib/site-config";
import { BOOK_A_CALL_URL, TAKE_ASSESSMENT_URL } from "../../lib/cta-urls";
import { buildAboutPagePersonLd } from "../../lib/schema-org";
import { jsonLdScript } from "../../lib/structured-data";
import { sanitiseName } from "../../lib/sanitise-name";
import { AnalyticsClient } from "../../components/analytics/analytics-client";
import {
  Hero,
  Section,
  CtaPair,
  ProofItem,
  StickyMobileCta,
} from "../../components/sections/home";
import {
  PersonCard,
  PhilosophyBlock,
  WayOfWorkingSteps,
} from "../../components/sections/about";
import { SOCIAL_LINKS, sameAsFor } from "../../lib/social-links";
import { dedupeSameAs } from "../../lib/schema-graph";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    // Brand-free: the layout template appends " — Archos Labs" (see app/page.tsx).
    title: "Rob Angeles, Fractional Data Architect",
    description:
      "25 years of data architecture and AI delivery. Rob Angeles works with startups and SMBs as their fractional data person or on short-term gigs. No full-time hire needed. Melbourne, Australia.",
    path: "/about",
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

const PHOTO_SRC: string | null = "/images/about-me.png";
const PHOTO_ALT =
  "Rob Angeles, photographed against the Melbourne skyline at dusk.";

const PERSON_BIO_PARAGRAPHS = [
  "25 years across healthcare, financial services, government, retail, and technology. I've been the data architect on programs with eight-figure budgets and the sole architect at early-stage startups building from scratch. The problems are the same at every scale — data nobody trusts, systems nobody has documented, and decisions being made without a foundation underneath them.",
  "I work with a small number of teams at a time. Startups and SMBs who need a senior data person without the full-time salary, or organisations with a specific data problem that needs to be scoped, fixed, and handed back.",
  "Same person on the call. Same person doing the work. No handoff. No junior team behind the pitch.",
];

const CREDENTIALS = [
  "CDMP",
  "Kimball",
  "Data Vault",
  "Databricks",
  "Snowflake",
  "dbt",
  "Anthropic",
  "Data Architecture",
  "Data Governance",
  "Sovereign AI",
  "AI Agent Development",
];

const SELECTED_WORK = [
  {
    eyebrow: "Startup · Sole architect",
    title: "Data architecture from scratch.",
    body:
      "Joined an early-stage platform as sole data architect. Built the transactional model, analytics layer, and full migration from the legacy system. No team. No handoff. Four years as their data person.",
    stat: "4 years  ·  greenfield to production",
  },
  {
    eyebrow: "SMB · Reporting",
    title: "50 reports. No analytics layer. Fixed.",
    body:
      "Operational and reporting queries on the same database. 50+ manual reports with no self-service. Built the OLAP layer, separated the concerns, migrated to Power BI.",
    stat: "50+ reports  ·  self-service from day one",
  },
  {
    eyebrow: "Tech startup · AI readiness",
    title: "Data wasn't ready for the model. Made it ready.",
    body:
      "Multiple disconnected systems. No unified view. An ML model waiting on data that wasn't clean. Built the integration layer and the ML-ready data model.",
    stat: "Single unified view  ·  ML pipeline unblocked",
  },
  {
    eyebrow: "Enterprise · AI agent",
    title: "COBOL lineage in 3 months.",
    body:
      "Built an AI agent that reads COBOL source code, extracts business rules, and outputs a clean data model ready for implementation. Team estimate was 6–9 months.",
    stat: "3 months  ·  estimate was 6–9",
  },
  {
    eyebrow: "Enterprise · Platform migration",
    title: "12-month migration delivered in 6.",
    body:
      "Data foundation work done upfront. Business-rule fidelity preserved end-to-end. The platform work ran clean because the data layer was right before build started.",
    stat: "6 months  ·  half the original timeline",
  },
  {
    eyebrow: "Solo build · Sovereign AI",
    title: "Fine-tuned model. Offline. $300 phone.",
    body:
      "Designed and shipped a fine-tuned AI model running fully offline on budget Android hardware. No cloud dependency. No server-side processing. The consensus was it couldn't be done.",
    stat: "7 days  ·  scoping to shipped",
  },
];

const WAY_OF_WORKING_STEPS = [
  {
    headline: "Every engagement starts with the diagnostic.",
    body:
      "8 minutes. No login. It tells you what's broken and whether I can fix it before any commitment is made.",
  },
  {
    headline: "Scoped and fixed before work begins.",
    body:
      "You see the number before we start. It doesn't move. No retainer. No open-ended billing.",
  },
  {
    headline: "Same person throughout.",
    body:
      "The person on the call runs the assessment, does the architecture work, and delivers. No handoff.",
  },
  {
    headline: "Small number of engagements at a time.",
    body:
      "Not capacity. The work requires full attention and I won't give a team less than that.",
  },
];

type AboutSearchParams = Promise<{
  name?: string | string[];
}>;

export default async function AboutPage({
  searchParams,
}: {
  searchParams: AboutSearchParams;
}) {
  const { name } = await searchParams;
  const rawName = Array.isArray(name) ? name[0] : name;
  const sanitisedName = sanitiseName(rawName);

  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const modellingRoomUrl = settings.modellingRoomUrl.trim();

  // Only the founder's own links go into the Person's sameAs — the brand's
  // X account (entity: "org" in lib/social-links.ts) would otherwise assert
  // Rob Angeles and Archos Labs are the same entity. See lib/schema-graph.ts.
  // Deduped through the same helper the layout's founder node uses: this block
  // and that one MERGE on a shared @id, so a URL spelled differently in each
  // (settings stores LinkedIn without a trailing slash, SOCIAL_LINKS with one)
  // surfaces as a duplicate in the combined node.
  const sameAs = dedupeSameAs([...sameAsFor("person"), modellingRoomUrl]);

  const personLd = buildAboutPagePersonLd({
    founderName: settings.founderName,
    siteUrl,
    sameAs,
  });

  const preparedOn = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      {/* Serialised via jsonLdScript() — founderName and the sameAs URLs
          come from the admin-editable site_setting row. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personLd) }}
      />

      <AnalyticsClient route="/about" />

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

        {/* 1. Hero — no eyebrow, no CTA, no anchor nav */}
        <Hero
          gradient="off"
          headline={
            <>
              The data team you
              <span className="block">don&rsquo;t have yet.</span>
            </>
          }
          subhead={
            <span className="mx-auto block max-w-[520px]">
              Most startups and small businesses don&rsquo;t have a senior
              data person. They have a founder making data decisions, a
              developer who set up the database, and a growing problem
              nobody has named yet. I step into that gap.
            </span>
          }
        />

        {/* 2. The Person */}
        <Section id="the-person" bg="bordered" pad="section">
          <PersonCard
            name={settings.founderName}
            role="Principal · Archos Labs"
            paragraphs={PERSON_BIO_PARAGRAPHS}
            credentials={CREDENTIALS}
            photoSrc={PHOTO_SRC}
            photoAlt={PHOTO_ALT}
            socialLinks={SOCIAL_LINKS}
          />
        </Section>

        {/* 3. Selected Work — 5 cards, 3-up top + 2-up bottom on desktop */}
        <Section id="selected-work" bg="canvas" pad="section">
          <div className="text-center">
            <h2 className="text-display-md text-ink">Work I&rsquo;ve delivered.</h2>
            <p className="mx-auto mt-5 max-w-[640px] text-body text-ink-subtle">
              Six engagements across 25 years. From early-stage startups to
              large programs. Anonymised by request. Specifics on the call.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3 md:gap-8">
            {SELECTED_WORK.map((w) => (
              <ProofItem
                key={w.title}
                eyebrow={w.eyebrow}
                title={w.title}
                body={w.body}
                stat={w.stat}
              />
            ))}
          </div>
        </Section>

        {/* 4. How I Work — 2x2 grid of cards (review feedback: borderless
            rendering read as unstyled placeholder; cards do the work). */}
        <Section id="how-i-work" bg="bordered" pad="section">
          <h2 className="text-center text-display-md text-ink">How I work.</h2>
          <div className="mx-auto mt-12 max-w-[920px]">
            <WayOfWorkingSteps steps={WAY_OF_WORKING_STEPS} />
          </div>
        </Section>

        {/* 5. What I Believe */}
        <Section id="what-i-believe" bg="canvas" pad="section">
          <h2 className="text-center text-display-md text-ink">
            What I believe.
          </h2>
          <div className="mt-12">
            <PhilosophyBlock
              introParagraph={
                <>
                  The model was never the constraint. Every AI project that
                  stalls hits the same wall — the data wasn&rsquo;t ready.
                  The governance existed on paper. Nobody could trace where
                  the numbers came from. That work happens before the model
                  arrives, not after it fails.
                </>
              }
              pullQuote={
                <>
                  A team that hears the hard answer in week two can fix
                  it. A team that hears it at launch cannot.
                </>
              }
              outroParagraph={
                <>
                  I built AI products as a solo founder. I&rsquo;ve been the
                  architect on programs that ran for years. The difference
                  in scale doesn&rsquo;t change what matters: clean data,
                  documented rules, and someone who will tell you the truth
                  before you spend more money.
                </>
              }
            />
          </div>
        </Section>

        {/* 6. CTA */}
        <Section id="book-a-call" bg="bordered" pad="section" centered>
          <h2 className="text-display-md text-ink">
            Start with the assessment.
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-body-lg text-ink-muted">
            8 minutes. No login. If the score says we should talk, I&rsquo;ll
            invite you to a 30-minute call. No pitch. No deck. Just a direct
            conversation about your data.
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
        hideWhenSelector="#book-a-call"
      />
    </>
  );
}
