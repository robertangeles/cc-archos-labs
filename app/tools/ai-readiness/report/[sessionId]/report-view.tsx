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
import { PrintButton } from "./print-button";

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
  critical: "border-[#f87171]/40 bg-[#f87171]/5 text-[#f87171]",
  high: "border-[#fb923c]/40 bg-[#fb923c]/5 text-[#fb923c]",
  medium: "border-[#fbbf24]/40 bg-[#fbbf24]/5 text-[#fbbf24]",
};

const sevLabels: Record<RiskSeverity, string> = {
  critical: "Critical risk",
  high: "Elevated risk",
  medium: "Risk",
};

export function ReportView({ report }: { report: LoadedReport }) {
  const { result, content } = report;

  // Claude returns the narrative as one string with \n\n between
  // paragraphs (per system prompt). Split for rendering.
  const paragraphs = content.narrative
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      {/* ====================================================================
          Section 1 — Verdict header
          ==================================================================== */}
      <section className="border-b border-rule px-6 py-16 md:px-12 md:py-24">
        <div className="mx-auto w-full max-w-[840px]">
          <div className="flex items-start justify-between gap-x-6">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-accent">
              AI Readiness Assessment
            </p>
            <PrintButton />
          </div>
          <div className="mt-8 flex flex-col gap-y-2 md:flex-row md:items-baseline md:gap-x-10 md:gap-y-0">
            <p className="font-mono text-[80px] font-semibold leading-none tracking-[-0.04em] text-fg md:text-[140px]">
              {result.score.total}
            </p>
            <div className="flex flex-col gap-y-1">
              <p className="text-2xl font-semibold leading-tight text-fg md:text-[36px] md:leading-[1.1]">
                {result.tier.label}
              </p>
              <p className="text-sm text-muted">
                {result.tier.tier} tier · score out of 100
              </p>
            </div>
          </div>
          <h1 className="mt-12 max-w-[760px] text-2xl font-medium leading-[1.3] tracking-[-0.01em] text-fg md:text-[30px]">
            {content.verdict}
          </h1>
        </div>
      </section>

      {/* ====================================================================
          Section 2 — Risk flags (only shown when triggered)
          ==================================================================== */}
      {result.riskFlags.length > 0 ? (
        <section className="border-b border-rule px-6 py-12 md:px-12 md:py-16">
          <div className="mx-auto w-full max-w-[840px]">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
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
                  <p className="mt-2 text-base font-semibold leading-[1.5] text-fg">
                    {f.title}
                  </p>
                  <p className="mt-1 text-sm leading-[1.55] text-fg/80">
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
          ==================================================================== */}
      <section className="border-b border-rule px-6 py-12 md:px-12 md:py-16">
        <div className="mx-auto w-full max-w-[840px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Domain breakdown
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
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
                  className="rounded-md border border-rule bg-surface px-5 py-5 print:break-inside-avoid"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                    {DOMAIN_LABELS[key]}
                  </p>
                  <p className="mt-3 font-mono text-4xl font-semibold leading-none text-fg">
                    {ds.percent}
                    <span className="text-xl text-muted">%</span>
                  </p>
                  <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-rule/60">
                    <div
                      className="h-full rounded-full bg-accent"
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
          ==================================================================== */}
      <section className="border-b border-rule px-6 py-16 md:px-12 md:py-20">
        <div className="mx-auto w-full max-w-[680px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Practitioner analysis
          </p>
          <div className="mt-8 flex flex-col gap-y-6 text-[18px] leading-[1.65] text-fg/90">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 5 — Priority action sequence
          ==================================================================== */}
      <section className="border-b border-rule px-6 py-12 md:px-12 md:py-16">
        <div className="mx-auto w-full max-w-[840px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
            Priority action sequence
          </p>
          <ol className="mt-6 flex flex-col gap-y-4">
            {content.action_plan.map((a, i) => (
              <ActionRow key={i} action={a} index={i + 1} />
            ))}
          </ol>
        </div>
      </section>

      {/* ====================================================================
          Section 6 — Next-step CTA
          ==================================================================== */}
      <section className="px-6 py-16 md:px-12 md:py-20">
        <div className="mx-auto w-full max-w-[840px] rounded-md border border-accent/30 bg-accent/5 px-6 py-8 md:px-10 md:py-10">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
            Next step
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-fg md:text-[32px]">
            This is what the two-week engagement addresses.
          </h2>
          <p className="mt-4 max-w-[600px] text-base leading-[1.6] text-muted">
            We map your data, governance, and AI surface area against
            what&rsquo;s viable and deliver a written assessment your CFO
            or board can act on. No retainer. No upsell. Practitioner
            work from day one.
          </p>
          <Link
            href="/contact"
            className="mt-8 inline-flex items-center rounded-md bg-accent px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
          >
            Book a 30-minute call
          </Link>
        </div>
      </section>
    </main>
  );
}

function ActionRow({ action, index }: { action: ActionItem; index: number }) {
  return (
    <li className="flex gap-x-5 rounded-md border border-rule bg-surface px-5 py-5 print:break-inside-avoid md:gap-x-7 md:px-6 md:py-6">
      <span className="font-mono text-base font-semibold text-accent">
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold leading-[1.4] text-fg md:text-[18px]">
          {action.title}
        </p>
        <p className="mt-2 text-sm leading-[1.6] text-muted md:text-base">
          {action.explanation}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.1em]">
          <span className="text-accent">
            {ACTION_TIME_HORIZON_LABELS[action.time_horizon]}
          </span>
          <span className="text-muted/50">·</span>
          <span className="text-muted">
            {SERVICE_LINE_LABELS[action.service_line]}
          </span>
        </div>
      </div>
    </li>
  );
}
