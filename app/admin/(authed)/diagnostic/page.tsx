import {
  DOMAIN_WEIGHTS,
  QUESTIONS,
  RISK_FLAG_RULES,
  TIER_BOUNDARIES,
  getQuestion,
} from "../../../../lib/diagnostic/content";
import {
  BLOCK_LABELS,
  DOMAIN_LABELS,
  isBranchQuestion,
  type AnswerCode,
  type Question,
  type QuestionBlock,
  type RiskSeverity,
} from "../../../../lib/diagnostic/types";

// Read-only review of the AI Readiness Assessment v1.0 spec encoding.
// Source of truth: lib/diagnostic/content.ts. Edit the file directly and
// redeploy; this view re-renders from the new data on the next request.
//
// Audience: the operator (Rob) checking that questions, scores, branch
// triggers, tier boundaries, and risk flag rules match the spec before
// the W2 scoring engine and UI build on top of these values.

const sevColours: Record<RiskSeverity, string> = {
  critical: "text-[#f87171] border-[#f87171]/30 bg-[#f87171]/5",
  high: "text-[#fb923c] border-[#fb923c]/30 bg-[#fb923c]/5",
  medium: "text-[#fbbf24] border-[#fbbf24]/30 bg-[#fbbf24]/5",
};

const scoreColours: Record<number, string> = {
  3: "text-accent",
  2: "text-fg",
  1: "text-muted",
  0: "text-[#f87171]",
};

function questionsByBlock(block: QuestionBlock): Question[] {
  return QUESTIONS.filter((q) => q.block === block);
}

function maxScoreFor(q: Question): number {
  return Math.max(...q.options.map((o) => o.score));
}

export default function AdminDiagnosticPage() {
  const baseCount = QUESTIONS.filter((q) => !isBranchQuestion(q)).length;
  const branchCount = QUESTIONS.filter(isBranchQuestion).length;

  return (
    <section className="flex flex-col gap-y-16">
      {/* ============================================================ */}
      {/* Header + summary stats                                          */}
      {/* ============================================================ */}
      <div>
        <h1 className="text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-fg md:text-[40px]">
          Diagnostic Content
        </h1>
        <p className="mt-4 max-w-[720px] text-base leading-[1.7] text-muted">
          Read-only view of the AI Readiness Assessment v1.0 spec
          encoding. Source of truth lives in{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[13px] text-fg">
            lib/diagnostic/content.ts
          </code>
          . Edit there + redeploy to update.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Base questions" value={baseCount} />
          <Stat label="Branch questions" value={branchCount} />
          <Stat label="Risk flag rules" value={RISK_FLAG_RULES.length} />
          <Stat label="Tiers" value={TIER_BOUNDARIES.length} />
        </div>
      </div>

      {/* ============================================================ */}
      {/* Domain weights                                                  */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">
          Domain weights
        </h2>
        <p className="mt-2 text-sm leading-[1.6] text-muted">
          Per spec §5.1. Weighted total = Σ (domain percent × weight).
        </p>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {(
            Object.entries(DOMAIN_WEIGHTS) as Array<
              [keyof typeof DOMAIN_WEIGHTS, number]
            >
          ).map(([domain, weight]) => (
            <div
              key={domain}
              className="rounded-md border border-rule bg-surface px-4 py-3"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                {DOMAIN_LABELS[domain]}
              </p>
              <p className="mt-1 text-2xl font-semibold text-fg">
                {Math.round(weight * 100)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Tier boundaries                                                 */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">
          Tier boundaries
        </h2>
        <p className="mt-2 text-sm leading-[1.6] text-muted">
          Per spec §5.2. Inclusive ranges on the 0–100 weighted total.
        </p>
        <div className="mt-4 overflow-hidden rounded-md border border-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                <th className="px-4 py-2.5">Range</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Public label</th>
              </tr>
            </thead>
            <tbody>
              {TIER_BOUNDARIES.map((t) => (
                <tr
                  key={t.tier}
                  className="border-t border-rule text-fg"
                >
                  <td className="px-4 py-2.5 font-mono text-muted">
                    {t.min}–{t.max}
                  </td>
                  <td className="px-4 py-2.5">{t.tier}</td>
                  <td className="px-4 py-2.5 text-muted">{t.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Questions, grouped by block                                     */}
      {/* ============================================================ */}
      {([1, 2, 3] as QuestionBlock[]).map((block) => {
        const blockQs = questionsByBlock(block);
        return (
          <div key={block}>
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">
              Block {block} — {BLOCK_LABELS[block]}
            </h2>
            <p className="mt-2 text-sm leading-[1.6] text-muted">
              {blockQs.length} question{blockQs.length === 1 ? "" : "s"} in
              this block (
              {blockQs.filter(isBranchQuestion).length} branch).
            </p>
            <div className="mt-6 flex flex-col gap-y-6">
              {blockQs.map((q) => (
                <QuestionCard key={q.id} question={q} />
              ))}
            </div>
          </div>
        );
      })}

      {/* ============================================================ */}
      {/* Risk flag rules                                                 */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">
          Risk flag rules
        </h2>
        <p className="mt-2 text-sm leading-[1.6] text-muted">
          Per spec §5.3. Up to three flags surface per session;
          severity-ordered. Earlier rules in this list break ties when
          severities are equal.
        </p>
        <div className="mt-4 flex flex-col gap-y-3">
          {RISK_FLAG_RULES.map((r) => (
            <div
              key={r.code}
              className={`rounded-md border px-4 py-3 ${sevColours[r.severity]}`}
            >
              <div className="flex items-baseline justify-between gap-x-4">
                <p className="text-sm font-semibold">
                  {r.title}
                </p>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em]">
                  {r.severity}
                </span>
              </div>
              <p className="mt-2 text-sm leading-[1.6] text-fg/90">
                {r.body}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted">
                <span className="text-muted/70">Triggers when:</span>
                {r.trigger.map((t, i) => {
                  const answers = Array.isArray(t.answer)
                    ? t.answer.join("/")
                    : t.answer;
                  return (
                    <span key={i}>
                      {i > 0 ? <span className="mx-1 text-muted/50">AND</span> : null}
                      <span className="rounded border border-rule bg-canvas px-1.5 py-0.5">
                        {t.questionId} = {answers}
                      </span>
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted/60">
                code: {r.code}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-rule bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
    </div>
  );
}

function QuestionCard({ question }: { question: Question }) {
  const branchParent = question.branch
    ? getQuestion(question.branch.parentQuestionId)
    : null;

  return (
    <div className="rounded-md border border-rule bg-surface/40 px-5 py-5">
      {/* Header row: ID, domain, type chip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-semibold text-accent">
          {question.id.toUpperCase()}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {DOMAIN_LABELS[question.domain]}
        </span>
        {isBranchQuestion(question) ? (
          <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-accent">
            Branch
          </span>
        ) : null}
      </div>

      {/* Question text */}
      <p className="mt-3 text-base font-medium leading-[1.5] text-fg">
        {question.text}
      </p>

      {/* Branch trigger detail */}
      {question.branch ? (
        <p className="mt-2 font-mono text-[11px] leading-[1.5] text-muted">
          Triggered when{" "}
          <span className="rounded border border-rule bg-canvas px-1 text-fg/90">
            {question.branch.parentQuestionId}
          </span>{" "}
          = {question.branch.triggerAnswers.join(" or ")}
          {branchParent ? (
            <span className="text-muted/60">
              {" "}
              ({branchParent.text.slice(0, 60)}…)
            </span>
          ) : null}
        </p>
      ) : null}

      {/* Options table */}
      <div className="mt-4 flex flex-col">
        {question.options.map((opt, i) => (
          <div
            key={opt.code}
            className={`flex items-center gap-x-4 px-3 py-2 ${
              i > 0 ? "border-t border-rule/50" : ""
            }`}
          >
            <span className="font-mono text-xs font-semibold text-muted">
              {opt.code}
            </span>
            <span className="flex-1 text-sm leading-[1.5] text-fg/90">
              {opt.label}
            </span>
            <span
              className={`font-mono text-xs font-semibold ${scoreColours[opt.score]}`}
            >
              {opt.score}
            </span>
          </div>
        ))}
        <div className="mt-2 px-3 text-right font-mono text-[11px] text-muted/70">
          max {maxScoreFor(question)} · domain {DOMAIN_LABELS[question.domain]}
        </div>
      </div>

      {/* Intent commentary (practitioner notes) */}
      {question.intent ? (
        <details className="mt-4 cursor-pointer text-sm">
          <summary className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted hover:text-fg">
            Intent
          </summary>
          <p className="mt-2 leading-[1.6] text-muted">{question.intent}</p>
        </details>
      ) : null}
    </div>
  );
}
