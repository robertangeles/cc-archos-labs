import { DOMAIN_LABELS, type Question } from "./types";
import type { SessionAnswers } from "./flow";
import type { SessionResult } from "./scoring";
import type { DiagnosticContent } from "./content-config-shared";

// AI Readiness Assessment Claude prompt design.
//
// The system prompt lives in the DB (site_setting key='diagnostic_prompt')
// and is loaded via lib/diagnostic/prompt-config.ts.getDiagnosticPrompt().
// Source contains only the deliberately-generic fallback (in
// lib/diagnostic/prompt-config-shared.ts) — the practitioner-voice prompt
// that produces real reports never lives in this repo.
//
// This file owns buildUserPrompt: the per-session, per-executive message
// that varies on every call. It composes the assessment answers and
// scoring result into a structured input that the system prompt operates
// on. Per-session content is not IP-sensitive (it's the user's own
// answers being read back to Claude).

// ----------------------------------------------------------------------------
// User-message builder — the per-session input the report is generated from
// ----------------------------------------------------------------------------

export function buildUserPrompt({
  answers,
  result,
  content,
}: {
  answers: SessionAnswers;
  result: SessionResult;
  content: DiagnosticContent;
}): string {
  const questionsById = buildQuestionsById(content);

  // Sector + role for context framing
  const sectorOption = lookupAnswerLabel(answers, "q1", questionsById);
  const roleOption = lookupAnswerLabel(answers, "q2", questionsById);

  // Full answer dump — Claude needs to reference the executive's
  // specific language, so we include question text + selected option
  // text verbatim.
  const answerLines: string[] = [];
  for (const [questionId, code] of Object.entries(answers)) {
    if (!code) continue;
    const question = questionsById[questionId];
    if (!question) continue;
    const option = question.options.find((o) => o.code === code);
    if (!option) continue;
    answerLines.push(
      `- ${questionId.toUpperCase()} "${question.text}"\n  Selected: "${option.label}" (score ${option.score} of ${question.options.reduce((m, o) => Math.max(m, o.score), 0)})`,
    );
  }

  // Risk flags currently triggered (already severity-sorted by scoring engine)
  const flagsBlock =
    result.riskFlags.length === 0
      ? "(No risk flags triggered)"
      : result.riskFlags
          .map(
            (f) =>
              `- [${f.severity.toUpperCase()}] ${f.title}\n  ${f.body}`,
          )
          .join("\n");

  return `EXECUTIVE CONTEXT
- Sector: ${sectorOption}
- Role in AI investment decisions: ${roleOption}

ASSESSMENT ANSWERS
${answerLines.join("\n")}

DOMAIN SCORES (0–100 per domain, weighted ${weightingDescription(content)} to total)
- ${DOMAIN_LABELS.data_foundation}: ${result.score.data_foundation.percent}% (raw ${result.score.data_foundation.raw}/${result.score.data_foundation.max})
- ${DOMAIN_LABELS.program_readiness}: ${result.score.program_readiness.percent}% (raw ${result.score.program_readiness.raw}/${result.score.program_readiness.max})
- ${DOMAIN_LABELS.org_reality}: ${result.score.org_reality.percent}% (raw ${result.score.org_reality.raw}/${result.score.org_reality.max})

OVERALL
- Total weighted score: ${result.score.total} / 100
- Tier: ${result.tier.tier} (${result.tier.label})
${result.isPriority ? `- Priority lead: ${result.priorityReasons[0]}` : ""}

RISK FLAGS TRIGGERED
${flagsBlock}

Write the report for this executive. Respond ONLY with the JSON object specified in the system prompt.`;
}

function lookupAnswerLabel(
  answers: SessionAnswers,
  questionId: string,
  questionsById: Record<string, Question>,
): string {
  const code = answers[questionId];
  if (!code) return "(not answered)";
  const question = questionsById[questionId];
  if (!question) return "(unknown question)";
  const option = question.options.find((o) => o.code === code);
  return option?.label ?? `(unknown answer: ${code})`;
}

function buildQuestionsById(
  content: DiagnosticContent,
): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (const q of content.questions) {
    out[q.id] = q;
  }
  return out;
}

// Human-readable rendering of the domain weights for the Claude prompt
// (e.g. "50/30/20"). Falls back gracefully if the weights don't sum
// nicely to 100 — content is admin-editable so weird values are possible.
function weightingDescription(content: DiagnosticContent): string {
  const pct = (n: number) => Math.round(n * 100);
  return `${pct(content.domainWeights.data_foundation)}/${pct(content.domainWeights.program_readiness)}/${pct(content.domainWeights.org_reality)}`;
}
