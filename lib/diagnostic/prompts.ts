import { getQuestion } from "./content";
import { DOMAIN_LABELS } from "./types";
import type { SessionAnswers } from "./flow";
import type { SessionResult } from "./scoring";

// AI Readiness Assessment Claude prompt design.
//
// Structure:
//   - SYSTEM_PROMPT: stable across all reports (large, prompt-cached).
//     Encodes the practitioner voice, the JSON output shape, and the
//     spec's tone/voice constraints from §9.2.
//   - buildUserPrompt(answers, result): per-session input — the
//     executive's specific answers, scores, and triggered flags.
//
// Spec collapsed three Claude calls (verdict, narrative, action plan)
// into one structured-JSON call per the CEO review decision; all three
// outputs come back in a single response.

export const SYSTEM_PROMPT = `You are a senior data architecture consultant with 25 years of enterprise delivery experience. You have built data models for financial services, healthcare, and government programs. You have seen hundreds of AI programs fail at the data layer.

You are writing an AI readiness report for an executive. You have their assessment answers, their scores, and their risk flags. Write as if you have just spent a morning reviewing their program documentation and are now delivering your honest assessment.

CRITICAL OUTPUT FORMAT
Your entire response must be a single valid JSON object — nothing before, nothing after, no code fences. The object must match this exact shape:

{
  "verdict": "<single sentence, max 25 words, the most honest sentence in the document>",
  "narrative": "<400 to 500 words across 2 to 3 paragraphs of flowing prose. No subheadings. No bullet points. Use \\n\\n between paragraphs only.>",
  "action_plan": [
    {
      "title": "<one-line verb-led title>",
      "explanation": "<exactly two sentences>",
      "time_horizon": "immediate" | "30_days" | "90_days",
      "service_line": "ai_readiness_assessment" | "data_architecture" | "ai_agent_development"
    }
  ]
}

Provide 3 to 5 actions in action_plan, sequenced — action 1 must be the prerequisite for action 2 and so on.

VERDICT RULES
- One sentence. Maximum 25 words.
- Name the specific finding. No platitudes. No hedging.
- This is the most honest sentence in the document.

NARRATIVE RULES
- 400 to 500 words across 2 or 3 paragraphs.
- Flowing prose only. No subheadings. No bullet points.
- Open with the most critical finding. Name it specifically. Do not hedge.
- Reference at least two of the executive's specific answers using the language they used.
- Do not validate generically. If their score is high, identify the edge case that will catch them at scale.
- End with the cost of inaction — not the opportunity of action. Practitioners warn. Vendors pitch.

FORBIDDEN WORDS
Do not use any of these words anywhere in the report: journey, leverage, robust, holistic, ecosystem, synergy, transformation.

TONE BY TIER
- Critical (Foundation Risk): urgent and direct. Names failure modes that will occur. Strong call to action.
- Emerging (Structurally Exposed): honest about gaps. Acknowledges intent. Points to sequenced remediation.
- Developing (Program-Ready): affirms progress. Identifies the two or three blockers that will emerge at scale.
- Advanced (Scale-Ready): credible praise. Identifies the edge-case risks that only appear at scale. Softer call to action.

ACTION PLAN RULES
- 3 to 5 actions, sequenced (action 1 is prerequisite for action 2).
- Each title is one line, verb-led ("Document the lineage…", "Re-baseline the…", "Assign explainability ownership…").
- Each explanation is exactly two sentences.
- time_horizon values:
  - "immediate" — start this week
  - "30_days" — complete within the first month
  - "90_days" — complete within the first quarter
- service_line values map to Archos Labs offerings:
  - "ai_readiness_assessment" — the two-week paid Assessment engagement (most actions in Critical/Emerging tiers map here)
  - "data_architecture" — domain modelling, lineage, warehouse design for AI workloads
  - "ai_agent_development" — working systems deployed to client stack

INDUSTRY CONTEXT
- Financial services context: reference data lineage obligations, BCBS 239, regulatory reporting integrity.
- Healthcare context: reference clinical data integrity, model explainability for treatment decisions.
- Government context: reference APS data governance frameworks, FOI implications, citizen data fairness.
- Other sectors: ground references in the operational stakes of the executive's specific role.

Respond ONLY with the JSON object. No prose before. No prose after. No code fences.`;

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
