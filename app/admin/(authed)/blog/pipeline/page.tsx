import Link from "next/link";
import { loadPipelineView } from "../../../../../lib/blog-agent/pipeline-view";
import { QueueRows } from "./queue-rows";

// /admin/blog/pipeline — the blog agent's queue.
//
// Designed to answer four questions in order: is it alive, is anything wrong,
// what is queued, and did the post actually go out.
//
// The last one needs its own section because the queue structurally cannot
// answer it. `published` is deliberately not a queue status — the scheduled
// publisher owns post.status and the queue owns its own, one writer per column
// — so live state is a join rather than a field.

export const dynamic = "force-dynamic";

const HEALTH_TONE = {
  running: {
    dot: "bg-semantic-success",
    text: "text-semantic-success",
    border: "border-hairline",
  },
  stopped: {
    dot: "bg-ink-subtle/50",
    text: "text-ink-subtle",
    border: "border-hairline",
  },
  stalled: {
    dot: "bg-semantic-error",
    text: "text-semantic-error",
    border: "border-semantic-error/40",
  },
  "never-run": {
    dot: "bg-semantic-warning",
    text: "text-semantic-warning",
    border: "border-semantic-warning/40",
  },
} as const;

function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function BlogPipelinePage() {
  const { health, rows, published, configProblem } = await loadPipelineView();
  const t = HEALTH_TONE[health.tone];
  const needingReview = rows.filter((r) => r.post?.needsReview).length;
  const scheduled = rows.filter(
    (r) => r.post?.status === "scheduled" && !r.post.needsReview,
  ).length;
  const failed = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-headline text-ink">Blog agent</h1>
          <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
            Topics the agent has queued, and what happened to each one. Posts
            that clear the gate publish on their own at the next free slot.
          </p>
        </div>
        <Link
          href="/admin/prompts/blog-agent-config"
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-hairline px-5 py-2 text-body-sm text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
        >
          Settings
        </Link>
      </header>

      {configProblem ? (
        <div
          role="alert"
          className="rounded-md border border-semantic-error/40 bg-semantic-error/5 px-5 py-4"
        >
          <p className="text-eyebrow uppercase text-semantic-error">
            Settings are broken
          </p>
          <p className="mt-2 text-body-sm leading-[1.6] text-ink/90">{configProblem}</p>
        </div>
      ) : null}

      {/* Is it alive, and is anything wrong. */}
      <section
        className={`rounded-md border ${t.border} bg-surface-1/30 px-5 py-5 sm:px-6`}
        aria-label="Agent status"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-eyebrow uppercase text-ink-subtle">Status</p>
            <p className={`mt-2 flex items-center gap-x-2 text-card-title ${t.text}`}>
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
              {health.headline}
            </p>
          </div>
          <div>
            <p className="text-eyebrow uppercase text-ink-subtle">Last run</p>
            <p className="mt-2 text-card-title text-ink">{ago(health.lastRunAt)}</p>
            {health.lastRunAt ? (
              <p className="mt-1 text-xs text-ink-subtle">
                {health.lastRunAt.toLocaleString("en-AU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-eyebrow uppercase text-ink-subtle">Published this week</p>
            <p className="mt-2 text-card-title text-ink">
              {health.postsThisWeek}
              <span className="text-ink-subtle"> / {health.targetThisWeek}</span>
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              {health.dueToday ? "Writing today" : "Not writing today"}
            </p>
          </div>
          <div>
            <p className="text-eyebrow uppercase text-ink-subtle">Needs you</p>
            <p
              className={`mt-2 text-card-title ${
                needingReview + failed > 0 ? "text-semantic-warning" : "text-ink"
              }`}
            >
              {needingReview + failed}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              {needingReview > 0 || failed > 0
                ? [
                    failed > 0 ? `${failed} failed` : null,
                    needingReview > 0 ? `${needingReview} held` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : scheduled > 0
                  ? `${scheduled} queued to publish`
                  : "Nothing waiting"}
            </p>
          </div>
        </div>

        <p className="mt-5 border-t border-hairline pt-4 text-body-sm leading-[1.6] text-ink/85">
          {health.detail}
        </p>
      </section>

      {/* What is queued. */}
      <section className="space-y-4">
        <h2 className="text-card-title text-ink">Queue</h2>
        <QueueRows rows={rows} />
      </section>

      {/* Did it actually go out. */}
      <section className="space-y-4">
        <h2 className="text-card-title text-ink">Recently published</h2>
        {published.length === 0 ? (
          <div className="rounded-md border border-hairline bg-surface-1/30 px-6 py-8 text-center">
            <p className="text-body-sm text-ink">Nothing published yet.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-[1.6] text-ink-subtle">
              Agent posts are scheduled for the next free slot and go live on
              their own. They appear here once that time arrives.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
            {published.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-y-1 bg-surface-1/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 sm:px-5"
              >
                <Link
                  href={`/blog/${p.slug}`}
                  className="min-w-0 text-body-sm text-ink hover:text-primary"
                >
                  {p.title}
                </Link>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {p.publishedAt
                    ? p.publishedAt.toLocaleDateString("en-AU", { dateStyle: "medium" })
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
