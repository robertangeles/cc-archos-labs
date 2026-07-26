"use client";

import { useState } from "react";
import Link from "next/link";
import type { QueueRow } from "../../../../../lib/blog-agent/pipeline-view";

// The queue list. Client-side only for what needs interaction: expanding a row
// to read why a draft was rejected, and retrying a failed one.
//
// Layout is a list, not a <table>. At 375px a table of quoted verdict text is
// unreadable, and the design review chose full responsive parity because the
// moment you most need this page is when you are away from your desk.

const TONE: Record<string, { dot: string; text: string; label: string }> = {
  failed: { dot: "bg-semantic-error", text: "text-semantic-error", label: "Failed" },
  running: { dot: "bg-semantic-warning", text: "text-semantic-warning", label: "Writing" },
  pending: { dot: "bg-ink-subtle/50", text: "text-ink-subtle", label: "Queued" },
  drafted: { dot: "bg-semantic-success", text: "text-semantic-success", label: "Drafted" },
  skipped: { dot: "bg-ink-subtle/40", text: "text-ink-subtle", label: "Skipped" },
};

function tone(status: string) {
  return TONE[status] ?? { dot: "bg-ink-subtle/50", text: "text-ink-subtle", label: status };
}

/** What the post attached to this item is actually doing, in plain words. */
function postState(row: QueueRow): { text: string; urgent: boolean } | null {
  if (!row.post) return null;
  if (row.post.status === "published") return { text: "Published", urgent: false };
  if (row.post.needsReview) {
    return { text: "Waiting for your review", urgent: true };
  }
  if (row.post.status === "scheduled" && row.post.scheduledPublishAt) {
    return {
      text: `Approved, publishes ${new Date(row.post.scheduledPublishAt).toLocaleString(
        "en-AU",
        { dateStyle: "medium", timeStyle: "short" },
      )}`,
      urgent: false,
    };
  }
  return { text: row.post.status, urgent: false };
}

export function QueueRows({ rows }: { rows: QueueRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [retried, setRetried] = useState<Set<string>>(new Set());

  async function retry(id: string) {
    setRetrying(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/blog-agent/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;
      if (res.ok && json?.ok) {
        setRetried((s) => new Set(s).add(id));
        setConfirming(null);
      } else {
        setError({ id, message: json?.error ?? "Could not queue that item again." });
      }
    } catch {
      setError({ id, message: "Network error." });
    } finally {
      setRetrying(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-hairline bg-surface-1/30 px-6 py-10 text-center">
        <p className="text-body-sm text-ink">Nothing queued.</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-[1.6] text-ink-subtle">
          The agent researches a fresh batch of topics on its own when the queue
          runs low. If that is not happening, check the refill threshold in{" "}
          <Link href="/admin/prompts/blog-agent-config" className="text-primary hover:underline">
            settings
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
      {rows.map((row) => {
        const t = tone(retried.has(row.id) ? "pending" : row.status);
        const expandable = row.rounds.some((r) => r.findings.length > 0);
        const isOpen = open === row.id;
        const state = postState(row);

        return (
          <li key={row.id} className="bg-surface-1/20">
            <div className="flex flex-col gap-y-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-x-4 sm:px-5">
              {/* Status */}
              <div className="flex shrink-0 items-center gap-x-2 sm:w-32 sm:pt-0.5">
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                <span className={`text-eyebrow uppercase ${t.text}`}>{t.label}</span>
              </div>

              {/* Title and everything under it */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* Once a post exists its title is the real thing; the plan
                      item's title is the brief that produced it, and showing
                      the brief made a queue of finished work look like junk. */}
                  {row.post ? (
                    <Link
                      href={`/admin/blog/posts/${row.post.id}`}
                      className="text-body-sm text-ink hover:text-primary"
                    >
                      {row.post.title}
                    </Link>
                  ) : (
                    <span className="text-body-sm text-ink">{row.title}</span>
                  )}
                  <span className="text-xs text-ink-subtle">Day {row.dayNumber}</span>
                  {row.categoryName ? (
                    <span className="text-xs text-ink-subtle/70">{row.categoryName}</span>
                  ) : null}
                </div>
                {row.post ? (
                  <p className="mt-0.5 text-xs text-ink-subtle/70">
                    Brief: {row.title}
                  </p>
                ) : null}

                {state ? (
                  <p
                    className={`mt-1 text-xs ${
                      state.urgent ? "text-semantic-warning" : "text-ink-subtle"
                    }`}
                  >
                    {state.text}
                  </p>
                ) : null}

                {row.lastError && !retried.has(row.id) ? (
                  <p className="mt-1 text-xs leading-[1.5] text-ink/80">{row.lastError}</p>
                ) : null}

                {expandable ? (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                    className="mt-2 inline-flex min-h-[44px] items-center text-xs text-primary hover:underline sm:min-h-0"
                  >
                    {isOpen
                      ? "Hide what the reviewer said"
                      : row.status === "failed"
                        ? "Why was this rejected?"
                        : // A drafted row with findings was flagged and then
                          // fixed by a rewrite. Calling that "rejected" would
                          // be the page telling a comfortable lie.
                          "What the reviewer said"}
                  </button>
                ) : null}

                {error?.id === row.id ? (
                  <p role="alert" className="mt-2 text-xs text-semantic-error">
                    {error.message}
                  </p>
                ) : null}
              </div>

              {/* Retry */}
              {row.status === "failed" && !retried.has(row.id) ? (
                <div className="shrink-0">
                  {confirming === row.id ? (
                    <div className="flex items-center gap-x-2">
                      <button
                        type="button"
                        onClick={() => retry(row.id)}
                        disabled={retrying === row.id}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-semantic-warning/50 px-4 py-2 text-xs text-semantic-warning hover:bg-semantic-warning/10 disabled:opacity-60"
                      >
                        {retrying === row.id ? "Queueing…" : "Yes, write it again"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="inline-flex min-h-[44px] items-center px-2 text-xs text-ink-subtle hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(row.id)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-hairline px-4 py-2 text-xs text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : retried.has(row.id) ? (
                <p className="shrink-0 text-xs text-semantic-success sm:pt-3">
                  Queued again
                </p>
              ) : null}
            </div>

            {/* Why it was rejected. The most valuable content on the page. */}
            {isOpen ? (
              <div className="border-t border-hairline bg-canvas/60 px-4 py-5 sm:px-5">
                {row.rounds.map((round) => (
                  <div key={round.round} className="mb-5 last:mb-0">
                    <p className="text-eyebrow uppercase text-ink-subtle/70">
                      {round.round === 0 ? "First draft" : `Rewrite ${round.round}`}
                      {round.findings.length === 0 ? " — cleared review" : ""}
                    </p>
                    {round.findings.length > 0 ? (
                      <dl className="mt-3 space-y-4">
                        {round.findings.map((f, i) => (
                          <div
                            key={`${round.round}-${i}`}
                            className="flex flex-col gap-y-1 sm:flex-row sm:gap-x-5"
                          >
                            <dt className="shrink-0 sm:w-48">
                              <span className="text-eyebrow uppercase text-semantic-error">
                                {f.tell.replace(/-/g, " ")}
                              </span>
                              {f.why ? (
                                <span className="mt-1 block text-xs leading-[1.5] text-ink-subtle">
                                  {f.why}
                                </span>
                              ) : null}
                            </dt>
                            <dd className="min-w-0 border-l border-hairline pl-4 text-body-sm italic leading-[1.6] text-ink/90">
                              &ldquo;{f.quote}&rdquo;
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
