import Link from "next/link";
import { notFound } from "next/navigation";
import type { BookingPromptKind } from "../../../../../lib/booking-prompts-shared";
import { BookingPromptEditor } from "./booking-prompt-editor";
import { DiagnosticPromptEditor } from "./diagnostic-prompt-editor";

// /admin/prompts/[slug] — drill-down editor for one prompt.
// Server-renders the title + description + breadcrumb, hands off to
// the matching client editor for the form interaction.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

type Slug =
  | "diagnostic"
  | "intake-followup"
  | "precall-brief"
  | "blog-matching";

const SLUG_TO_BOOKING_KEY: Partial<Record<Slug, BookingPromptKind>> = {
  "intake-followup": "followup",
  "precall-brief": "brief",
  "blog-matching": "blogMatch",
};

const META: Record<Slug, { title: string; description: string; fires: string }> =
  {
    diagnostic: {
      title: "Diagnostic narrative",
      description:
        "System prompt sent to Claude for the AI Readiness Assessment report. Owns voice, output shape, forbidden words, tone-by-tier. The version label here is stamped onto every saved report so you can correlate report quality with prompt edits.",
      fires: "Fires on every report generation.",
    },
    "intake-followup": {
      title: "Intake follow-up",
      description:
        "After a prospect types a reason on the booking form, Claude decides whether ONE follow-up question would sharpen what you need to know. If yes, it's asked inline before the prospect submits.",
      fires: "Fires once when the prospect leaves the reason field on /book/[slug].",
    },
    "precall-brief": {
      title: "Pre-call brief",
      description:
        "Claude reads the prospect's intake (reason + optional follow-up Q&A) and produces a tight brief: priority score (P1/P2/P3), one-paragraph summary, three specific talking points. Sent to your inbox 2h before the call.",
      fires: "Fires from the cron processor on the precall_brief scheduled_job.",
    },
    "blog-matching": {
      title: "Blog matching",
      description:
        "Picks 0–3 blog posts from a library that are GENUINELY relevant to the prospect's stated problem. Will render in the confirmation email under 'while you wait'. Library + wiring not yet shipped — prompt is staged for that work.",
      fires:
        "Not currently fired. Will fire on booking-create once the blog library lands.",
    },
  };

const VALID_SLUGS: Slug[] = [
  "diagnostic",
  "intake-followup",
  "precall-brief",
  "blog-matching",
];

export default async function PromptDetailPage({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  if (!(VALID_SLUGS as string[]).includes(rawSlug)) {
    notFound();
  }
  const slug = rawSlug as Slug;
  const meta = META[slug];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/prompts"
          className="text-eyebrow uppercase text-ink-subtle hover:text-ink"
        >
          ← Prompts
        </Link>
        <h1 className="mt-2 text-headline text-ink">{meta.title}</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          {meta.description}
        </p>
        <p className="mt-1 text-caption text-ink-subtle/70">{meta.fires}</p>
      </div>

      {slug === "diagnostic" ? (
        <DiagnosticPromptEditor />
      ) : (
        <BookingPromptEditor promptKey={SLUG_TO_BOOKING_KEY[slug]!} />
      )}
    </div>
  );
}
