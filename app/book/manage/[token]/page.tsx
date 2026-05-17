import Link from "next/link";
import type { Metadata } from "next";
import { verifyManageToken } from "../../../../lib/booking";
import {
  JWTExpiredError,
  JWTInvalidError,
  JWTRevokedError,
} from "../../../../lib/errors/booking";
import { buildPageMetadata } from "../../../../lib/site-config";
import { ManageView } from "./manage-view";

// Public manage page. The confirmation email links here with a signed
// JWT that authorizes either cancel or reschedule on the booking. The
// page verifies the token server-side and renders the manage UI; if
// the link is expired/invalid/used, it shows a friendly error.

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Manage your booking",
    description: "Cancel or reschedule your upcoming call.",
  });
}

export default async function ManagePage({ params }: PageProps) {
  const { token } = await params;

  let context: Awaited<ReturnType<typeof verifyManageToken>> | null = null;
  let errorMessage: string | null = null;

  try {
    context = await verifyManageToken({ token });
  } catch (err) {
    if (err instanceof JWTExpiredError) {
      errorMessage =
        "This link has expired. If you still need to cancel or reschedule, email us.";
    } else if (
      err instanceof JWTRevokedError ||
      err instanceof JWTInvalidError
    ) {
      errorMessage =
        "This link has already been used or is no longer valid. If you booked again, check the latest confirmation email.";
    } else {
      console.error("[book/manage page] verify failed:", err);
      errorMessage =
        "Something went wrong verifying this link. Try again, or email us.";
    }
  }

  if (errorMessage || !context) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-20">
        <p className="text-eyebrow uppercase text-ink-subtle">Manage booking</p>
        <h1 className="mt-3 text-display-md text-ink">Link not usable</h1>
        <p className="mt-4 max-w-xl text-body text-ink-subtle">
          {errorMessage}
        </p>
        <p className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-hairline-strong px-5 py-2.5 text-button text-ink transition-colors duration-150 hover:bg-surface-1"
          >
            ← Back to home
          </Link>
        </p>
      </main>
    );
  }

  const { booking, consultant } = context;
  const slotLabel = formatSlotInTz(booking.slotStart, booking.prospectTimezone);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-20">
      <p className="text-eyebrow uppercase text-ink-subtle">Manage booking</p>
      <h1 className="mt-3 text-display-md text-ink">
        Your call with {consultant.displayName}
      </h1>

      <section className="mt-8 rounded-md border border-hairline bg-surface-1 p-6">
        <p className="text-eyebrow uppercase text-ink-subtle">When</p>
        <p className="mt-2 text-card-title text-ink">{slotLabel}</p>
        <p className="mt-1 text-body-sm text-ink-subtle">
          {consultant.slotMinutes} min on Google Meet ·{" "}
          {booking.prospectTimezone}
        </p>
        {booking.meetUrl ? (
          <p className="mt-4">
            <a
              href={booking.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body-sm text-primary underline-offset-2 hover:underline"
            >
              Open Meet link →
            </a>
          </p>
        ) : null}
      </section>

      <ManageView token={token} consultantSlug={consultant.slug} />
    </main>
  );
}

function formatSlotInTz(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
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
