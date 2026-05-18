// About page — practitioner dossier composed from the
// components/sections/about/ family (PersonCard, PhilosophyBlock,
// WayOfWorkingSteps, SelectedWorkCard) + reused home section primitives
// (Hero, Section, CtaPair, StickyMobileCta, AnchorNav).
//
// Locked decisions live in ~/.claude/plans/next-isd-we-wil-majestic-pillow.md
// (D1–D4) and wiki/decisions/2026-05-18-about-page.md (summary).
//
// Server Component. Reads ?name= URL param server-side for the optional
// print-personalisation header (sanitised via lib/sanitise-name). All
// other user input pathways are absent — no DB writes, no API calls on
// render, no JS state on the page beyond the existing shipped client
// components (CtaPair, AnchorNav, StickyMobileCta).
//
// External URLs (LinkedIn + Modelling Room) flow from `site_setting`
// (admin-editable at /admin/site). Empty strings render the page
// gracefully — links omitted and Person `sameAs` filters them out.
// Workspace photo path is a top-of-file constant; placeholder ships
// until Rob supplies a photo.

import type { Metadata } from "next";
import {
  buildPageMetadata,
  getSiteSettings,
  getSiteUrl,
} from "../../lib/site-config";
import { BOOK_A_CALL_URL, TAKE_ASSESSMENT_URL } from "../../lib/cta-urls";
import { buildAboutPagePersonLd } from "../../lib/schema-org";
import { sanitiseName } from "../../lib/sanitise-name";
import { AnalyticsClient } from "../../components/analytics/analytics-client";
import {
  Hero,
  Section,
  CtaPair,
  StickyMobileCta,
} from "../../components/sections/home";
import {
  PersonCard,
  PhilosophyBlock,
  WayOfWorkingSteps,
  SelectedWorkCard,
  type SocialLink,
} from "../../components/sections/about";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "About",
    description:
      "Rob Angeles, Principal Consultant at Archos Labs. 25 years across financial services, healthcare, and government. One person who runs the assessment, the architecture, and the delivery.",
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
  microcopy: "30 min · we'll tell you if it's not a fit",
};

// Workspace photo. Environmental portrait of Rob against the Melbourne
// skyline at dusk — the brief was "practitioner in context, not a
// LinkedIn headshot against a white background." File lives at
// /public/images/about-me.png.
const PHOTO_SRC: string | null = "/images/about-me.png";
const PHOTO_ALT = "Rob Angeles photographed against the Melbourne skyline at dusk.";

const ANCHOR_NAV_ITEMS = [
  { label: "The person", href: "#the-person" },
  { label: "Selected work", href: "#selected-work" },
  { label: "Philosophy", href: "#the-philosophy" },
  { label: "How we engage", href: "#way-of-working" },
];

const PERSON_BIO_PARAGRAPHS = [
  "Twenty-five years across healthcare, financial services, government, retail, and consulting. Data architecture and AI agent development, including sovereign and local AI for organisations where data cannot leave the building, at the foundation. Lineage mapping, governance frameworks, and the kind of workshop facilitation that gets SMEs to say what they actually know rather than what sounds safe in a meeting room.",
  "CDMP certified. Kimball and Data Vault practitioner. The person who built an AI agent that delivered full COBOL-to-target lineage in 3 months when the estimate was 6 to 9. The person who compressed a 12-month platform migration to 6. Who then fine-tuned an AI model and shipped it running fully offline on a $300 Android phone — because the problem was worth solving and the consensus that it could not be done was wrong.",
  "Not a firm that staffs a team behind a pitch. One person who has been in the trench, knows what breaks, and knows how to fix it.",
];

const CREDENTIALS = [
  "CDMP",
  "Kimball",
  "Data Vault",
  "Databricks",
  "OpenAI",
  "Anthropic",
  "Data Modeling",
  "Data Governance",
  "Data Architecture",
  "Sovereign and Local AI",
  "AI Product Build",
];

// Founder identity links. Page-level constants so the row renders out
// of the box without an admin step. If/when these need to rotate
// without dev help, lift them into `site_setting` (mirrors the
// founderLinkedinUrl path) and read via getSiteSettings().
const SOCIAL_LINKS: SocialLink[] = [
  { platform: "linkedin", url: "https://www.linkedin.com/in/robangeles22/" },
  { platform: "x", url: "https://x.com/archoslabsxyz" },
  { platform: "github", url: "https://github.com/robertangeles/" },
  { platform: "huggingface", url: "https://huggingface.co/robangeles" },
];

const SELECTED_WORK = [
  {
    label: "Major health insurer · COBOL lineage agent",
    outcome:
      "3 months. Estimate was 6 to 9. AI agent reads COBOL source, extracts business rules, routes them through SME review, outputs a data model ready for implementation on the new platform.",
  },
  {
    label: "Sovereign AI on a $300 Android",
    outcome:
      "7 days from scoping to shipped. Fine-tuned model runs fully offline on budget Android hardware. The consensus was it could not be done. The consensus was wrong.",
  },
  {
    label: "Platform migration · 12 months to 6",
    outcome:
      "Half the timeline. Business-rule fidelity preserved end-to-end. The work that breaks programs at the data layer, done upfront so the platform work could run clean.",
  },
];

const PHILOSOPHY_LEAD = "The model was never the constraint.";

const PHILOSOPHY_PARAGRAPHS = [
  "Every AI program that stalls, fails, or gets quietly shelved hits the same wall. The data was not ready. The governance existed on paper. Nobody could trace where the numbers came from. The business case was a narrative built on assumptions that the infrastructure beneath it could not support.",
  "We believe the work that matters happens before the model arrives. Lineage. Governance. Domain modelling. Business rules extracted from the people who carry them in their heads and documented in a form a CFO can defend. That is the foundation. Everything built on it works. Everything built without it eventually fails.",
];

const PHILOSOPHY_SECONDARY =
  "We also believe in telling the truth early. A program that hears the hard answer in week two is recoverable. A program that hears it at deployment is not.";

const WAY_OF_WORKING_STEPS = [
  {
    headline: "Every engagement starts with the AI Readiness Assessment.",
    body: "Two weeks. We map what is actually there against what the program needs. The output is written and specific. You know what is ready, what is not, and what fixing it costs before any further commitment is made.",
  },
  {
    headline: "Engagements are scoped and fixed.",
    body: "The same person who ran the assessment does the architecture work and the delivery. No handoff. No junior team behind the pitch. No retainer that keeps billing while the program drifts.",
  },
  {
    headline: "Small number of engagements at a time.",
    body: "Not because of capacity. The work requires full attention and we will not give a program less than that.",
  },
  {
    headline: "If we are not the right fit, we will say so on the call.",
    body: "No deck. No qualification process. Just a direct conversation about what is broken and whether we can fix it.",
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
  // Coerce the ?name=a&name=b array form to a single value — only the
  // first is considered. Mirrors home's handling so behaviour is
  // consistent across personalised print artefacts.
  const rawName = Array.isArray(name) ? name[0] : name;
  const sanitisedName = sanitiseName(rawName);

  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const modellingRoomUrl = settings.modellingRoomUrl.trim();

  // sameAs payload for the Person JSON-LD. Combines the page-level
  // SOCIAL_LINKS (canonical founder identities) with the optional
  // Modelling Room newsletter URL from site_setting. Empty strings are
  // filtered inside buildAboutPagePersonLd.
  const sameAs = [
    ...SOCIAL_LINKS.map((link) => link.url),
    modellingRoomUrl,
  ];

  const personLd = buildAboutPagePersonLd({
    founderName: settings.founderName,
    orgName: settings.siteName,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
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

        <Hero
          eyebrow="About"
          headline={
            <>
              We know the problems you cannot say{" "}
              <span className="text-primary">out loud</span>.
            </>
          }
          subhead={
            <>
              Your data is not ready and everyone in the room knows it. The
              business case was built on assumptions nobody has tested. The
              vendor is confident. Your team is not. And the program is
              moving anyway.
            </>
          }
          anchorNav={{ items: ANCHOR_NAV_ITEMS }}
        />

        {/* The Person */}
        <Section id="the-person" bg="canvas">
          <h2 className="text-display-md text-ink">The person.</h2>
          <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
            We have been in that room. On the delivery side, the
            architecture side, and the side where someone has to tell an
            executive something they do not want to hear. That is where
            Archos Labs works.
          </p>
          <div className="mt-12">
            <PersonCard
              name={settings.founderName}
              role="Principal Consultant"
              paragraphs={PERSON_BIO_PARAGRAPHS}
              credentials={CREDENTIALS}
              photoSrc={PHOTO_SRC}
              photoAlt={PHOTO_ALT}
              socialLinks={SOCIAL_LINKS}
            />
          </div>
        </Section>

        {/* Selected Work — receipts before belief */}
        <Section id="selected-work" bg="surface-1">
          <h2 className="text-display-md text-ink">Selected work.</h2>
          <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
            Three of the programs we have shipped. Anonymised by request.
            Specifics on the call.
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-10">
            {SELECTED_WORK.map((w) => (
              <SelectedWorkCard
                key={w.label}
                label={w.label}
                outcome={w.outcome}
              />
            ))}
          </div>
        </Section>

        {/* The Philosophy */}
        <Section id="the-philosophy" bg="canvas">
          <h2 className="text-display-md text-ink">What we believe.</h2>
          <div className="mt-12">
            <PhilosophyBlock
              leadQuote={PHILOSOPHY_LEAD}
              paragraphs={PHILOSOPHY_PARAGRAPHS}
              secondaryQuote={PHILOSOPHY_SECONDARY}
            />
          </div>
        </Section>

        {/* The Way of Working */}
        <Section id="way-of-working" bg="surface-1">
          <h2 className="text-display-md text-ink">How we engage.</h2>
          <div className="mt-12">
            <WayOfWorkingSteps steps={WAY_OF_WORKING_STEPS} />
          </div>
        </Section>

        {/* CTA — uses #book-a-call as the sticky-CTA hide selector */}
        <Section id="book-a-call" bg="bordered" pad="relaxed" centered>
          <h2 className="text-headline text-ink md:text-display-md">
            If this sounds like the firm you have been looking for.
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-body text-ink-subtle">
            Start with the assessment. Eight minutes. It tells you where
            your program is exposed and whether what we do is relevant to
            where you are. If the score says we should talk, we will invite
            you to a 30-minute call.
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
