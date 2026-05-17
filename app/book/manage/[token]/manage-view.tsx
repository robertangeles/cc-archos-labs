"use client";

import Link from "next/link";
import { useState } from "react";

// Client island for the manage page. Server has already verified the
// token before this renders, so we just expose the two actions and
// post to /api/booking/cancel or navigate to the reschedule page.
//
// State machine: 'initial' → 'confirming-cancel' → ('cancelling' →
// 'cancelled') or back to 'initial'. Errors are surfaced inline.

interface ManageViewProps {
  token: string;
  consultantSlug: string;
}

type State =
  | { kind: "initial" }
  | { kind: "confirming-cancel" }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export function ManageView({ token, consultantSlug }: ManageViewProps) {
  const [state, setState] = useState<State>({ kind: "initial" });

  async function handleCancel() {
    setState({ kind: "cancelling" });
    try {
      const resp = await fetch("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await resp.json();
      if (resp.ok && body.ok) {
        setState({ kind: "cancelled" });
        return;
      }
      setState({
        kind: "error",
        message: body.error ?? "Could not cancel. Try again or email us.",
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  if (state.kind === "cancelled") {
    return (
      <section className="mt-8 rounded-md border border-semantic-success/40 bg-semantic-success/5 p-6">
        <p className="text-eyebrow uppercase text-semantic-success">
          Cancelled
        </p>
        <p className="mt-2 text-card-title text-ink">
          Your call is cancelled.
        </p>
        <p className="mt-3 text-body-sm text-ink-subtle">
          A cancellation email is on the way. No further reminders will land.
        </p>
        <p className="mt-6">
          <Link
            href={`/book/${consultantSlug}`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover"
          >
            Pick a new time
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/book/manage/${encodeURIComponent(token)}/reschedule`}
          className="inline-flex items-center justify-center rounded-md border border-hairline-strong bg-surface-2 px-5 py-2.5 text-button text-ink transition-colors duration-150 hover:bg-surface-3"
        >
          Reschedule
        </Link>
        {state.kind === "confirming-cancel" ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={false}
              className="inline-flex items-center justify-center rounded-md bg-semantic-error px-5 py-2.5 text-button text-white transition-colors duration-150 hover:bg-semantic-error/90"
            >
              Confirm cancel
            </button>
            <button
              type="button"
              onClick={() => setState({ kind: "initial" })}
              className="text-body-sm text-ink-subtle underline hover:text-ink"
            >
              Never mind
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setState({ kind: "confirming-cancel" })}
            disabled={state.kind === "cancelling"}
            className="inline-flex items-center justify-center rounded-md border border-semantic-error/40 px-5 py-2.5 text-button text-semantic-error transition-colors duration-150 hover:bg-semantic-error/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.kind === "cancelling" ? "Cancelling…" : "Cancel this call"}
          </button>
        )}
      </div>

      {state.kind === "confirming-cancel" ? (
        <p className="text-body-sm text-ink-subtle">
          Cancelling sends a cancellation email and frees the slot. This can&apos;t be undone.
        </p>
      ) : null}

      {state.kind === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-semantic-error/40 bg-semantic-error/5 px-3 py-2 text-body-sm text-semantic-error"
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
