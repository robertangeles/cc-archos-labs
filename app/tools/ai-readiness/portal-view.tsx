import Link from "next/link";
import type { LeadPortalData } from "../../../lib/diagnostic/report";

// Return-visitor portal — what a signed-in lead sees when they hit
// /tools/ai-readiness. Shows their previous reports + a retake button
// gated by a 30-day cooldown. First-time visitors don't see this view
// (the page renders <Assessment /> for them instead).
//
// Server component. No client interactivity required for v1 — the
// retake button is just a Link to the assessment if allowed, or a
// disabled-looking element if not.

export function PortalView({ data }: { data: LeadPortalData }) {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <section className="mx-auto w-full max-w-[840px] px-6 pt-24 pb-32 md:px-12 md:pt-32">
        {/* Greeting */}
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-primary">
          Welcome back
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-[40px]">
          {data.firstName} {data.lastName}
        </h1>
        {data.organisation ? (
          <p className="mt-3 text-base leading-[1.6] text-ink-subtle">
            {data.organisation}
          </p>
        ) : null}

        {/* Reports list */}
        {data.reports.length === 0 ? (
          <NoReportsBlock />
        ) : (
          <ReportsList reports={data.reports} />
        )}

        {/* Retake CTA */}
        <div className="mt-16 border-t border-hairline pt-12">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
            Run again
          </p>
          {data.retakeAllowed ? (
            <RetakeAvailable />
          ) : (
            <RetakeLocked unlocksAt={data.retakeUnlocksAt} />
          )}
        </div>
      </section>
    </main>
  );
}

function ReportsList({
  reports,
}: {
  reports: LeadPortalData["reports"];
}) {
  return (
    <div className="mt-12">
      <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
        {reports.length === 1
          ? "Your report"
          : `Your reports (${reports.length})`}
      </p>
      <ul className="mt-5 flex flex-col gap-y-3">
        {reports.map((r) => (
          <li
            key={r.sessionId}
            className="rounded-md border border-hairline bg-surface-1 px-5 py-5 transition-colors duration-150 hover:border-primary/50 md:px-6 md:py-6"
          >
            <Link
              href={`/tools/ai-readiness/report/${r.sessionId}`}
              className="flex flex-col gap-y-2 md:flex-row md:items-baseline md:justify-between md:gap-x-8"
            >
              <div className="flex items-baseline gap-x-5">
                <span className="font-mono text-2xl font-semibold leading-none text-ink md:text-[32px]">
                  {r.totalScore}
                </span>
                <span className="flex flex-col gap-y-0.5">
                  <span className="text-base font-medium text-ink">
                    {r.tierLabel}
                  </span>
                  <span className="text-xs uppercase tracking-[0.08em] text-ink-subtle">
                    {r.tier} tier · {formatCompleted(r.completedAt)}
                  </span>
                </span>
              </div>
              <span className="text-sm font-medium text-primary">
                Open report →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoReportsBlock() {
  return (
    <div className="mt-12 rounded-md border border-hairline bg-surface-1 px-6 py-6">
      <p className="text-sm leading-[1.6] text-ink-subtle">
        We have your account but no completed assessments yet. Start one
        below — it takes about eight minutes.
      </p>
    </div>
  );
}

function RetakeAvailable() {
  return (
    <>
      <h2 className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-ink md:text-[28px]">
        Ready to run the assessment again?
      </h2>
      <p className="mt-3 max-w-[600px] text-base leading-[1.6] text-ink-subtle">
        About eight minutes. Your previous report stays on this page —
        the new run produces a fresh report alongside it.
      </p>
      <Link
        href="/tools/ai-readiness?retake=1"
        className="mt-8 inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
      >
        Start a new assessment
      </Link>
    </>
  );
}

function RetakeLocked({ unlocksAt }: { unlocksAt: Date | null }) {
  const dateLabel = unlocksAt
    ? unlocksAt.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <>
      <h2 className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-ink md:text-[28px]">
        Retake available {dateLabel ? `on ${dateLabel}` : "soon"}.
      </h2>
      <p className="mt-3 max-w-[640px] text-base leading-[1.6] text-ink-subtle">
        The assessment looks at organisation-level signals that move
        slowly — running it more than once a month surfaces noise, not
        signal. If something material has changed (new sponsor, new
        regulatory pressure, post-incident review), get in touch via the
        contact form and we&rsquo;ll talk before a retake.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center rounded-md border border-hairline bg-surface-1 px-5 py-3 text-base font-medium text-ink-subtle">
          Retake locked
        </span>
        <Link
          href="/contact"
          className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
        >
          Talk to us instead
        </Link>
      </div>
    </>
  );
}

function formatCompleted(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
