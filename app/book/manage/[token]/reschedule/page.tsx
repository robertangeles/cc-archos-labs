import Link from "next/link";
import type { Metadata } from "next";
import { verifyManageToken } from "../../../../../lib/booking";
import {
  JWTExpiredError,
  JWTInvalidError,
  JWTRevokedError,
} from "../../../../../lib/errors/booking";
import { buildPageMetadata } from "../../../../../lib/site-config";
import { RescheduleForm } from "./reschedule-form";

// /book/manage/[token]/reschedule
//
// Server-renders the existing booking context + a slot picker for the
// new time. The client form posts to /api/booking/reschedule which
// atomically creates a new booking row, swaps the Google event, sends
// the new confirmation, and supersedes the old row.
//
// Token is verified on every render here too — defence-in-depth against
// someone jumping to /reschedule from the manage URL after the token
// was already consumed by a cancel.

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Reschedule your call",
    description: "Pick a new time for your call.",
  });
}

export default async function ReschedulePage({ params }: PageProps) {
  const { token } = await params;

  let context: Awaited<ReturnType<typeof verifyManageToken>> | null = null;
  let errorMessage: string | null = null;

  try {
    context = await verifyManageToken({ token });
  } catch (err) {
    if (err instanceof JWTExpiredError) {
      errorMessage = "This link has expired.";
    } else if (
      err instanceof JWTRevokedError ||
      err instanceof JWTInvalidError
    ) {
      errorMessage = "This link has already been used or is no longer valid.";
    } else {
      console.error("[book/manage/reschedule page] verify failed:", err);
      errorMessage = "Something went wrong verifying this link.";
    }
  }

  if (errorMessage || !context) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-20">
        <p className="text-eyebrow uppercase text-ink-subtle">Reschedule</p>
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
  const currentSlotLabel = formatSlotInTz(
    booking.slotStart,
    booking.prospectTimezone,
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
      <p className="text-eyebrow uppercase text-ink-subtle">Reschedule</p>
      <h1 className="mt-3 text-display-md text-ink">
        Pick a new time
      </h1>
      <p className="mt-4 max-w-2xl text-body text-ink-subtle">
        You&apos;re currently booked for {currentSlotLabel}. Choose a new
        slot below and we&apos;ll move the call. The old time frees up
        automatically.
      </p>

      <RescheduleForm
        token={token}
        consultant={{
          slug: consultant.slug,
          displayName: consultant.displayName,
          slotMinutes: consultant.slotMinutes,
          timezone: consultant.timezone,
        }}
        currentSlotStart={booking.slotStart.toISOString()}
        prospectTimezone={booking.prospectTimezone}
      />
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
