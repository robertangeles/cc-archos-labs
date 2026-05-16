import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { bookingRequest, consultant } from "../../../../../lib/db/schema";
import { buildPageMetadata } from "../../../../../lib/site-config";

// Server-rendered confirmation page. Loaded immediately after a
// successful POST to /api/booking/[slug]/create. Shows the slot details,
// the Meet link, and a "what happens next" rundown.
//
// We DON'T expose any token / jti here — the manage URL lives in the
// confirmation email, not in the URL bar. That keeps a shared screenshot
// from leaking a working cancel link.

interface PageProps {
  params: Promise<{ slug: string; bookingId: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return buildPageMetadata({
    title: "You're booked",
    description: "Confirmation for your call.",
  });
}

export default async function BookingConfirmationPage({ params }: PageProps) {
  const { slug, bookingId } = await params;

  const rows = await getDb()
    .select({
      id: bookingRequest.id,
      name: bookingRequest.name,
      slotStart: bookingRequest.slotStart,
      slotEnd: bookingRequest.slotEnd,
      prospectTimezone: bookingRequest.prospectTimezone,
      meetUrl: bookingRequest.meetUrl,
      status: bookingRequest.status,
      consultantSlug: consultant.slug,
      consultantDisplayName: consultant.displayName,
      consultantTimezone: consultant.timezone,
      consultantSlotMinutes: consultant.slotMinutes,
    })
    .from(bookingRequest)
    .innerJoin(consultant, eq(consultant.id, bookingRequest.consultantId))
    .where(eq(bookingRequest.id, bookingId))
    .limit(1);

  const booking = rows[0];
  if (!booking || booking.consultantSlug !== slug) {
    notFound();
  }

  const firstName = booking.name.trim().split(/\s+/)[0] ?? "there";
  const slotLabel = formatSlotInTz(
    booking.slotStart,
    booking.prospectTimezone,
  );

  const isPendingSync = booking.status === "pending_calendar_sync";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-20">
      <p className="text-eyebrow uppercase text-semantic-success">
        Confirmed
      </p>
      <h1 className="mt-3 text-display-md text-ink">
        Thanks, {firstName}. You&apos;re on the calendar.
      </h1>

      <section className="mt-10 rounded-md border border-hairline bg-surface-1 p-6">
        <p className="text-eyebrow uppercase text-ink-subtle">When</p>
        <p className="mt-2 text-card-title text-ink">{slotLabel}</p>
        <p className="mt-1 text-body-sm text-ink-subtle">
          {booking.consultantSlotMinutes} min on Google Meet ·{" "}
          {booking.prospectTimezone}
        </p>

        {isPendingSync ? (
          <p className="mt-6 rounded-md border border-semantic-warning/40 bg-semantic-warning/5 px-3 py-2 text-body-sm text-semantic-warning">
            We&apos;re finishing the calendar sync — your Meet link will land
            in your inbox within minutes.
          </p>
        ) : booking.meetUrl ? (
          <p className="mt-6">
            <a
              href={booking.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover"
            >
              Open Meet link
            </a>
          </p>
        ) : null}
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-card-title text-ink">What happens next</h2>
        <ul className="space-y-3 text-body text-ink-subtle">
          <li className="flex gap-3">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              You&apos;ll get a confirmation email shortly with the Meet link
              and a one-click cancel / reschedule link.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              A 24h reminder lands the day before. A final reminder lands an
              hour before with the Meet link again.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              {booking.consultantDisplayName} will read your intake before the
              call so the first 10 minutes aren&apos;t small talk.
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}

function formatSlotInTz(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
