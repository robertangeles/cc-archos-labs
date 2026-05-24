import Link from "next/link";
import {
  ACTION_TIME_HORIZON_LABELS,
  SERVICE_LINE_LABELS,
  type ActionItem,
} from "../../../../../lib/diagnostic/report-types";
import {
  DOMAIN_LABELS,
  type Domain,
  type RiskSeverity,
} from "../../../../../lib/diagnostic/types";
import type { LoadedReport } from "../../../../../lib/diagnostic/report";
import type { ShareTokenSummary } from "../../../../../lib/share-tokens";
import { BOOK_A_CALL_URL } from "../../../../../lib/cta-urls";
import { RecommendedReadings } from "../../../../../components/diagnostic/recommended-readings";
import { PrintButton } from "./print-button";
import { ShareControls } from "./share-controls";

// Six-section report layout per spec §6.
//
//   1. Verdict header — score numeral + tier label + Claude verdict
//   2. Risk flags — coloured callouts, max 3, severity-sorted
//   3. Domain score dashboard — three cards (no benchmark bars per
//      the CEO-review reduction; faked numbers were a credibility hole)
//   4. Practitioner analysis — Claude-generated 400–500 word narrative
//   5. Priority action sequence — 3–5 numbered actions with horizon + service line
//   6. Next-step CTA — book a 30-minute call (sized to the tier later)

const sevColours: Record<RiskSeverity, string> = {
  critical: "border-semantic-error/40 bg-semantic-error/5 text-semantic-error",
  high: "border-semantic-high/40 bg-semantic-high/5 text-semantic-high",
  medium: "border-semantic-warning/40 bg-semantic-warning/5 text-semantic-warning",
};

const sevLabels: Record<RiskSeverity, string> = {
  critical: "Critical risk",
  high: "Elevated risk",
  medium: "Risk",
};

export interface ReportViewProps {
  report: LoadedReport;
  /** Controls owner-only chrome (ShareControls) and shared-view banners.
   *  Defaults to "owner" so the existing owner page works unchanged. */
  viewMode?: "owner" | "shared";
  /** Active share tokens for this report. Only consumed when
   *  viewMode === "owner". Required there; ignored in "shared" mode. */
  shareTokens?: ShareTokenSummary[];
}

export function ReportView({
  report,
  viewMode = "owner",
  shareTokens = [],
}: ReportViewProps) {
  const { result, content } = report;

  // Claude returns the narrative as one string with \n\n between
  // paragraphs (per system prompt). Split for rendering.
  const paragraphs = content.narrative
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // recipient + generatedAt intentionally NOT destructured for render
  // anymore — they're consumed by the Puppeteer headerTemplate in
  // app/api/diagnostic/report/[sessionId]/pdf/route.ts which fetches
  // them via loadReport(sessionId). The PDF prints a one-line
  // "Prepared for X · Org · DD Month YYYY" letterhead in every
  // page's top margin instead of stamping the block on the cover.

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      {viewMode === "shared" ? <SharedReportBanner /> : null}
      {/* ====================================================================
          Section 1 — Verdict / cover
          On screen: a tight summary header.
          In print: opens the summary PAGE (cover + risk flags + domain
          breakdown all fit on page 1). Subsequent sections force their
          own page breaks via print:break-before-page. The cover here
          uses its natural content height so the rest of page 1 has
          room — no min-h-[9in] full-page push.
          ==================================================================== */}
      <section className="border-b border-hairline px-6 py-16 md:px-12 md:py-24 print:border-b-0 print:pt-0 print:pb-6">
        <div className="mx-auto w-full max-w-[840px]">
          {/* Print-only branded masthead. Hidden on screen because the
              site header already carries the logo. */}
          <div className="hidden print:mb-6 print:flex print:items-center print:gap-x-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <p className="text-base font-semibold tracking-tight text-ink">
              Archos Labs
            </p>
          </div>

          <div className="flex items-start justify-between gap-x-6">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-primary print:text-[11px]">
              AI Readiness Assessment
            </p>
            <PrintButton
              sessionId={
                viewMode === "owner" ? report.sessionId : undefined
              }
            />
          </div>
          <div className="mt-8 flex flex-col gap-y-2 md:flex-row md:items-baseline md:gap-x-10 md:gap-y-0 print:mt-4">
            <p className="font-mono text-[80px] font-semibold leading-none tracking-[-0.04em] text-ink md:text-[140px] print:text-[72px]">
              {result.score.total}
            </p>
            <div className="flex flex-col gap-y-1">
              <p className="text-2xl font-semibold leading-tight text-ink md:text-[36px] md:leading-[1.1] print:text-[26px]">
                {result.tier.label}
              </p>
              <p className="text-sm text-ink-subtle">
                {result.tier.tier} tier · score out of 100
              </p>
            </div>
          </div>
          <h1 className="mt-12 max-w-[760px] text-2xl font-medium leading-[1.3] tracking-[-0.01em] text-ink md:text-[30px] print:mt-5 print:text-[18px] print:leading-[1.4]">
            {content.verdict}
          </h1>

          {/* "Prepared for / Prepared on" intentionally NOT rendered
              on the cover. The Puppeteer PDF route puts a one-line
              letterhead in the top margin of every page (recipient
              name + organisation + prepared-on date) — that's the
              professional pattern and frees the cover content area
              for the actual case material (score + verdict + risk
              flags + domain breakdown). The `recipient` + `preparedOn`
              values used above are still consumed by the print
              header template via the LoadedReport returned to the
              PDF route. */}
        </div>
      </section>

      {/* ====================================================================
          Section 2 — Risk flags (only shown when triggered)
          ==================================================================== */}
      {result.riskFlags.length > 0 ? (
        <section className="border-b border-hairline px-6 py-12 md:px-12 md:py-16 print:border-b-0 print:py-4">
          <div className="mx-auto w-full max-w-[840px]">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
              {result.riskFlags.length === 1
                ? "Risk flag"
                : `${result.riskFlags.length} risk flags`}
            </p>
            <ul className="mt-5 flex flex-col gap-y-3">
              {result.riskFlags.map((f) => (
                <li
                  key={f.code}
                  className={`rounded-md border px-5 py-4 print:break-inside-avoid ${sevColours[f.severity]}`}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em]">
                    {sevLabels[f.severity]}
                  </p>
                  <p className="mt-2 text-base font-semibold leading-[1.5] text-ink">
                    {f.title}
                  </p>
                  <p className="mt-1 text-sm leading-[1.55] text-ink/80">
                    {f.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ====================================================================
          Section 3 — Domain score dashboard
          Closes out the page-1 summary (cover + risk flags + domain
          breakdown). Section 4 below forces a new page.
          ==================================================================== */}
      <section className="border-b border-hairline px-6 py-12 md:px-12 md:py-16 print:border-b-0 print:py-4">
        <div className="mx-auto w-full max-w-[840px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
            Domain breakdown
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 print:grid-cols-3 print:gap-2 md:grid-cols-3">
            {(
              [
                "data_foundation",
                "program_readiness",
                "org_reality",
              ] as Domain[]
            ).map((key) => {
              const ds = result.score[key];
              return (
                <div
                  key={key}
                  className="rounded-md border border-hairline bg-surface-1 px-5 py-5 print:break-inside-avoid"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
                    {DOMAIN_LABELS[key]}
                  </p>
                  <p className="mt-3 font-mono text-4xl font-semibold leading-none text-ink">
                    {ds.percent}
                    <span className="text-xl text-ink-subtle">%</span>
                  </p>
                  <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-hairline/60">
                    <div
                      className="h-full rounded-full bg-ink"
                      style={{ width: `${ds.percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 4 — Practitioner analysis
          Forced new page in print — the analysis is a full read that
          deserves its own page, not the tail of the summary.
          ==================================================================== */}
      <section className="border-b border-hairline px-6 py-16 md:px-12 md:py-20 print:border-b-0 print:py-6 print:break-before-page">
        <div className="mx-auto w-full max-w-[840px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
            Practitioner analysis
          </p>
          <div className="mt-8 flex flex-col gap-y-6 text-[18px] leading-[1.65] text-ink/90 print:mt-4 print:gap-y-3 print:text-[12.5px] print:leading-[1.6]">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 5 — Priority action sequence
          Forced new page. ActionRow has break-inside-avoid so
          individual actions don't split mid-card if the list itself
          overflows to a second page.
          ==================================================================== */}
      <section className="border-b border-hairline px-6 py-12 md:px-12 md:py-16 print:border-b-0 print:py-6 print:break-before-page">
        <div className="mx-auto w-full max-w-[840px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
            Priority action sequence
          </p>
          <ol className="mt-6 flex flex-col gap-y-4 print:mt-5 print:gap-y-3">
            {content.action_plan.map((a, i) => (
              <ActionRow key={i} action={a} index={i + 1} />
            ))}
          </ol>
        </div>
      </section>

      {/* ====================================================================
          Section 5b — Recommended Reading (Translation Layer posts that
          argue the case for each action above). Quiet-renders nothing
          when the rec list is empty (retrieval/gloss degraded, or all
          matched posts have since been unpublished). Forced new page
          in print — supporting evidence belongs as its own section,
          not stranded as a heading at the bottom of the action plan
          page (which is exactly what was happening before).
          ==================================================================== */}
      {report.recommendedReadings.length > 0 ? (
        <section className="border-b border-hairline px-6 py-12 md:px-12 md:py-16 print:border-b-0 print:py-6 print:break-before-page">
          <div className="mx-auto w-full max-w-[840px]">
            <RecommendedReadings items={report.recommendedReadings} />
          </div>
        </section>
      ) : null}

      {/* ====================================================================
          Owner share controls — only rendered for the owner view, not
          the public /share/[token] view. Print-hidden via the
          component's own class.
          ==================================================================== */}
      {viewMode === "owner" ? (
        <ShareControls
          sessionId={report.sessionId}
          initialTokens={shareTokens}
        />
      ) : null}

      {/* ====================================================================
          Section 6 — Next-step CTA
          Forced new page so "book a call" gets the exec's full
          attention — last impression, not a trailing scrap at the
          bottom of the recommended-reading page.
          ==================================================================== */}
      <section className="px-6 py-16 md:px-12 md:py-20 print:py-8 print:break-before-page">
        <div className="mx-auto w-full max-w-[840px] rounded-md border border-primary/30 bg-primary/5 px-6 py-8 md:px-10 md:py-10 print:break-inside-avoid">
          <p className="uppercase text-eyebrow text-ink-subtle">
            Next step
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-ink md:text-[32px] print:text-[24px]">
            This is what the two-week engagement addresses.
          </h2>
          <p className="mt-4 max-w-[600px] text-base leading-[1.6] text-ink-subtle print:text-[13px]">
            We map your data, governance, and AI surface area against
            what&rsquo;s viable and deliver a written assessment your CFO
            or board can act on. No retainer. No upsell. Practitioner
            work from day one.
          </p>
          <Link
            href={BOOK_A_CALL_URL}
            className="mt-8 inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
          >
            Book a 30-minute call
          </Link>
          {/* Print-only callout with the URL — the on-screen button
              isn't clickable in a printed PDF, so we surface the
              destination as text. */}
          <p className="hidden text-[12px] leading-[1.5] text-ink-subtle print:mt-5 print:block">
            Book at archoslabs.xyz{BOOK_A_CALL_URL}, or reply to the
            email this report came from.
          </p>
        </div>

        {/* Print-only confidential footer on the last page. */}
        <div className="hidden print:mt-12 print:block">
          <div className="mx-auto w-full max-w-[840px] border-t border-hairline pt-6 text-center text-[10px] uppercase tracking-[0.1em] text-ink-subtle">
            Archos Labs · Confidential · archoslabs.xyz
          </div>
        </div>
      </section>
    </main>
  );
}

// Banner shown above the verdict on the public /share/[token] view so
// the recipient understands this is a forwarded report (not signed-in).
// Hidden on print so the PDF stays clean.
function SharedReportBanner() {
  return (
    <div className="border-b border-hairline bg-surface-1 px-6 py-4 print:hidden md:px-12">
      <div className="mx-auto flex w-full max-w-[840px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-primary">
          Shared report
        </span>
        <span className="text-sm leading-[1.55] text-ink-subtle">
          You&rsquo;re viewing this report via a shared link. The link
          expires after 7 days and can be revoked at any time by the
          report owner.
        </span>
      </div>
    </div>
  );
}

function ActionRow({ action, index }: { action: ActionItem; index: number }) {
  return (
    <li className="flex gap-x-5 rounded-md border border-hairline bg-surface-1 px-5 py-5 print:break-inside-avoid md:gap-x-7 md:px-6 md:py-6">
      <span className="font-mono text-base font-semibold text-primary">
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold leading-[1.4] text-ink md:text-[18px]">
          {action.title}
        </p>
        <p className="mt-2 text-sm leading-[1.6] text-ink-subtle md:text-base">
          {action.explanation}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.1em]">
          <span className="text-primary">
            {ACTION_TIME_HORIZON_LABELS[action.time_horizon]}
          </span>
          <span className="text-ink-subtle/50">·</span>
          <span className="text-ink-subtle">
            {SERVICE_LINE_LABELS[action.service_line]}
          </span>
        </div>
      </div>
    </li>
  );
}
