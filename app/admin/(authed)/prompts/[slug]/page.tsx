import Link from "next/link";
import { notFound } from "next/navigation";
import type { BookingPromptKind } from "../../../../../lib/booking-prompts-shared";
import { BlogLibraryEditor } from "./blog-library-editor";
import { BookingPromptEditor } from "./booking-prompt-editor";
import { ChatPromptEditor } from "./chat-prompt-editor";
import { BlogAgentConfigEditor } from "./blog-agent-config-editor";
import { BlogAgentPromptEditor } from "./blog-agent-prompt-editor";
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
  | "workspace-chat"
  | "intake-followup"
  | "precall-brief"
  | "blog-matching"
  | "blog-agent-config"
  | "blog-judge-prompt"
  | "blog-plan-prompt";

const SLUG_TO_BOOKING_KEY: Partial<Record<Slug, BookingPromptKind>> = {
  "intake-followup": "followup",
  "precall-brief": "brief",
  "blog-matching": "blogMatch",
};

const META: Record<Slug, { title: string; description: string; fires: string }> =
  {
    "workspace-chat": {
      title: "Workspace chat",
      description:
        "The core identity prompt for the workspace chat assistant. Defines persona, tone, guardrails, and domain context. Applied to every chat message for every user. The version label here tracks which prompt version is live.",
      fires: "Fires on every chat message sent in the workspace.",
    },
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
        "Picks 0–3 blog posts from a library that are GENUINELY relevant to the prospect's stated problem. Renders in the confirmation email under 'while you wait'.",
      fires:
        "Fires on booking-create when the blog library has entries.",
    },
    "blog-agent-config": {
      title: "Blog agent",
      description:
        "Settings for the agent that researches, writes and queues blog posts on its own. The stop control is here, and it takes effect on the next run. Nothing the agent writes reaches the public site until you clear the review flag on that post.",
      fires: "Runs from a scheduled job, once per due day.",
    },
    "blog-judge-prompt": {
      title: "Blog reviewer",
      description:
        "The rubric an independent model grades every draft against before it can be queued. It reads the research alongside the draft, so \u201cis this claim supported?\u201d is answerable rather than guessable, and every finding it reports must quote the sentence it objects to.",
      fires: "Fires once per draft, and once more if a rewrite is needed.",
    },
    "blog-plan-prompt": {
      title: "Blog topic planner",
      description:
        "The brief that turns research about what founders are searching for into a batch of article topics. Each item becomes one queued post, so this shapes what gets written for weeks at a time.",
      fires: "Fires when the queue drops below the refill threshold.",
    },
  };

const VALID_SLUGS: Slug[] = [
  "diagnostic",
  "workspace-chat",
  "intake-followup",
  "precall-brief",
  "blog-matching",
  // The blog agent's three. Their absence is why the runbook's kill-switch
  // URL 404'd — the page it named was never reachable.
  "blog-agent-config",
  "blog-judge-prompt",
  "blog-plan-prompt",
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
      ) : slug === "workspace-chat" ? (
        <ChatPromptEditor />
      ) : slug === "blog-agent-config" ? (
        <BlogAgentConfigEditor />
      ) : slug === "blog-judge-prompt" ? (
        <BlogAgentPromptEditor kind="judge" />
      ) : slug === "blog-plan-prompt" ? (
        <BlogAgentPromptEditor kind="plan" />
      ) : (
        <BookingPromptEditor promptKey={SLUG_TO_BOOKING_KEY[slug]!} />
      )}

      {slug === "blog-matching" && (
        <>
          <hr className="border-hairline" />
          <BlogLibraryEditor />
        </>
      )}
    </div>
  );
}
