import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  BookingPromptsSchema,
  SITE_SETTING_KEY as BOOKING_PROMPTS_KEY,
  type BookingPrompts,
} from "../../../../lib/booking-prompts-shared";
import { getDb } from "../../../../lib/db";
import { siteSetting } from "../../../../lib/db/schema";
import {
  DiagnosticPromptSchema,
} from "../../../../lib/diagnostic/prompt-config-shared";
import { SITE_SETTING_KEY as DIAGNOSTIC_PROMPT_KEY } from "../../../../lib/diagnostic/prompt-config";

// /admin/prompts — cards grid of all Claude prompts used across the site.
// Mirrors the /admin/integrations layout: one card per prompt, status
// at a glance, click drills into the editor.
//
// Each card surfaces:
//   - The prompt's purpose (one-line description + where it fires)
//   - A status pill: Configured (admin-edited) / Starter (hardcoded
//     fallback) / Not configured (only diagnostic — hard-fail state)
//
// Server-rendered. Loads diagnostic prompt + booking_prompts rows once
// and computes status per card.

export const dynamic = "force-dynamic";

type CardStatus =
  | { tone: "success"; label: string }
  | { tone: "warning"; label: string }
  | { tone: "neutral"; label: string }
  | { tone: "error"; label: string };

interface PromptCard {
  slug: string;
  title: string;
  description: string;
  fires: string;
  status: CardStatus;
}

export default async function PromptsIndexPage() {
  const { diagnosticStatus, bookingPrompts } = await loadCardData();

  const cards: PromptCard[] = [
    {
      slug: "diagnostic",
      title: "Diagnostic narrative",
      description:
        "The system prompt sent to Claude on every AI Readiness Assessment report. Voice, output shape, forbidden words, tone-by-tier.",
      fires: "Fires on every report generation.",
      status: diagnosticStatus,
    },
    {
      slug: "intake-followup",
      title: "Intake follow-up",
      description:
        "When a prospect types a reason on the booking form, Claude decides whether ONE follow-up question would sharpen what you need to know.",
      fires: "Fires on /book/[slug] when the prospect leaves the reason field.",
      status: bookingStatus(bookingPrompts, "followup"),
    },
    {
      slug: "precall-brief",
      title: "Pre-call brief",
      description:
        "Claude reads the prospect's intake and produces a tight brief for you — priority, summary, three talking points. Sent to your inbox.",
      fires: "Fires from the cron processor 2h before each call.",
      status: bookingStatus(bookingPrompts, "brief"),
    },
    {
      slug: "blog-matching",
      title: "Blog matching",
      description:
        "Picks 0–3 blog posts from a library that match the prospect's stated problem. Renders in the confirmation email as 'while you wait'.",
      fires:
        "Not yet wired — confirmation email currently sends an empty list.",
      status: bookingStatus(bookingPrompts, "blogMatch"),
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Prompts</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          Claude prompts that drive the AI surfaces of the site. Tune
          voice, output shape, or behaviour without redeploying. The
          diagnostic prompt is required for the AI Readiness Assessment
          to work; booking prompts gracefully fall back to hardcoded
          starters if missing.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.slug}>
            <Link
              href={`/admin/prompts/${card.slug}`}
              className="group block rounded-md border border-hairline bg-surface-1/30 p-5 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-1/60"
            >
              <div className="flex items-start justify-between gap-x-4">
                <h3 className="text-card-title text-ink group-hover:text-ink">
                  {card.title}
                </h3>
                <StatusPill status={card.status} />
              </div>
              <p className="mt-2 text-body-sm text-ink-subtle">
                {card.description}
              </p>
              <p className="mt-2 text-caption text-ink-subtle/70">
                {card.fires}
              </p>
              <p className="mt-4 text-eyebrow uppercase text-ink-subtle/70 group-hover:text-primary">
                Edit →
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Status loader + helpers
// ----------------------------------------------------------------------------

async function loadCardData(): Promise<{
  diagnosticStatus: CardStatus;
  bookingPrompts: BookingPrompts | null;
}> {
  const db = getDb();
  let diagnosticStatus: CardStatus;
  try {
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, DIAGNOSTIC_PROMPT_KEY))
      .limit(1);
    if (rows.length === 0) {
      diagnosticStatus = { tone: "error", label: "Not configured" };
    } else {
      const parsed = DiagnosticPromptSchema.safeParse(rows[0].value);
      diagnosticStatus = parsed.success
        ? { tone: "success", label: "Configured" }
        : { tone: "error", label: "Malformed" };
    }
  } catch (err) {
    console.error("[admin/prompts] diagnostic status load failed:", err);
    diagnosticStatus = { tone: "warning", label: "Unknown" };
  }

  let bookingPrompts: BookingPrompts | null = null;
  try {
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, BOOKING_PROMPTS_KEY))
      .limit(1);
    if (rows.length > 0) {
      const parsed = BookingPromptsSchema.safeParse(rows[0].value);
      if (parsed.success) bookingPrompts = parsed.data;
    }
  } catch (err) {
    console.error("[admin/prompts] booking status load failed:", err);
  }

  return { diagnosticStatus, bookingPrompts };
}

// A booking sub-prompt is "Configured" if its version label is anything
// other than the literal starter sentinel. Treating version-label as the
// admin's signal of "I've taken ownership" is more reliable than diffing
// the full systemPrompt string (which can drift on whitespace).
function bookingStatus(
  prompts: BookingPrompts | null,
  key: "followup" | "brief" | "blogMatch",
): CardStatus {
  if (!prompts) {
    return { tone: "neutral", label: "Starter" };
  }
  const version = prompts[key]?.version ?? "";
  if (!version || version === "starter-v0") {
    return { tone: "neutral", label: "Starter" };
  }
  return { tone: "success", label: "Configured" };
}

function StatusPill({ status }: { status: CardStatus }) {
  const cls = {
    success: "border-semantic-success/40 text-semantic-success",
    warning: "border-semantic-warning/40 text-semantic-warning",
    neutral: "border-hairline text-ink-subtle",
    error: "border-semantic-error/40 text-semantic-error",
  }[status.tone];
  const dotCls = {
    success: "bg-semantic-success",
    warning: "bg-semantic-warning",
    neutral: "bg-ink-subtle/50",
    error: "bg-semantic-error",
  }[status.tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-x-1.5 rounded-full border px-2 py-0.5 text-eyebrow uppercase ${cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
      {status.label}
    </span>
  );
}
