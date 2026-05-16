import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConsultantBySlug } from "../../../lib/booking";
import { getIntegrationConfig } from "../../../lib/integration-config";
import { getSiteSettings, buildPageMetadata } from "../../../lib/site-config";
import { BookingForm } from "./booking-form";

// Public Book-a-Call page. Server-renders the consultant header + the
// interactive form. The form fetches availability client-side so the
// slot list stays fresh per render (no stale ISR cache).
//
// Gated only by consultant.googleStatus — if the calendar isn't
// connected we show a friendly "booking paused" state instead of the
// form. No auth required to view; the form itself runs anti-spam
// (honeypot + Turnstile) before accepting a submit.

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const consultant = await getConsultantBySlug(slug).catch(() => null);
  if (!consultant) {
    return buildPageMetadata({ title: "Book a call" });
  }
  return buildPageMetadata({
    title: `Book a call with ${consultant.displayName}`,
    description: `${consultant.slotMinutes}-minute Google Meet. Pick a time that suits you — Rob will send a brief before the call.`,
    path: `/book/${slug}`,
  });
}

export default async function BookCallPage({ params }: PageProps) {
  const { slug } = await params;
  const consultant = await getConsultantBySlug(slug);
  if (!consultant) {
    notFound();
  }

  // Turnstile site key is public (rendered into the page) — fetch from
  // Settings so the admin can swap it without redeploying.
  let turnstileSiteKey: string | null = null;
  try {
    const config = await getIntegrationConfig();
    turnstileSiteKey = config.turnstileSiteKey;
  } catch (err) {
    console.error("[book/[slug] page] config load failed:", err);
  }

  const settings = await getSiteSettings();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
      <header className="mb-12">
        <p className="text-eyebrow uppercase text-ink-subtle">Book a call</p>
        <h1 className="mt-3 text-display-md text-ink">
          {consultant.slotMinutes} minutes with {consultant.displayName}
        </h1>
        <p className="mt-4 max-w-2xl text-body text-ink-subtle">
          A focused {consultant.slotMinutes}-min Google Meet to discuss your
          program. {settings.founderName} will send a brief an hour before
          so the call starts at depth.
        </p>
      </header>

      {consultant.googleStatus !== "ok" ? (
        <div className="rounded-md border border-hairline bg-surface-1 p-8 text-center">
          <p className="text-card-title text-ink">Booking is paused</p>
          <p className="mt-3 text-body-sm text-ink-subtle">
            We&apos;re reconnecting the calendar. Try again shortly or reach
            us at{" "}
            <a
              href={`mailto:${consultant.email}`}
              className="text-primary underline"
            >
              {consultant.email}
            </a>
            .
          </p>
        </div>
      ) : (
        <BookingForm
          slug={slug}
          consultant={{
            displayName: consultant.displayName,
            slotMinutes: consultant.slotMinutes,
            timezone: consultant.timezone,
          }}
          turnstileSiteKey={turnstileSiteKey}
        />
      )}
    </main>
  );
}
