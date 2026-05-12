import { getQuestion } from "./content";
import { DOMAIN_LABELS } from "./types";
import type { SessionAnswers } from "./flow";
import type { SessionResult } from "./scoring";

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
}: {
  answers: SessionAnswers;
  result: SessionResult;
}): string {
  // Sector + role for context framing
  const sectorOption = lookupAnswerLabel(answers, "q1");
  const roleOption = lookupAnswerLabel(answers, "q2");

  // Full answer dump — Claude needs to reference the executive's
  // specific language, so we include question text + selected option
  // text verbatim.
  const answerLines: string[] = [];
  for (const [questionId, code] of Object.entries(answers)) {
    if (!code) continue;
    const question = getQuestion(questionId);
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

DOMAIN SCORES (0–100 per domain, weighted 50/30/20 to total)
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
): string {
  const code = answers[questionId];
  if (!code) return "(not answered)";
  const question = getQuestion(questionId);
  if (!question) return "(unknown question)";
  const option = question.options.find((o) => o.code === code);
  return option?.label ?? `(unknown answer: ${code})`;
}
