import type {
  DomainWeights,
  PriorityTrigger,
  Question,
  RiskFlagRule,
  TierBoundary,
} from "./types";

// AI Readiness Assessment — concrete content per the v1.0 product spec.
//
// This file is the single source of truth for question wording, answer
// options, scoring weights, branch logic, risk flag rules, tier
// boundaries, and domain weights. Treat it as data, not code — review it
// end-to-end against the spec before each release.
//
// Content authoring discipline:
//   - Question IDs are stable across spec versions. Add new questions
//     with new IDs; never repurpose an old ID.
//   - Branch question IDs follow `<parentId><suffix>` (e.g. q6a, q9b).
//   - Answer scores follow the spec's 0–3 scale; 3 = strongest readiness
//     signal, 0 = highest risk. Per-option scores below are first-pass
//     calibration from the spec's answer ordering and intent commentary
//     (the spec describes scoring as "0–3 with 3 = strongest readiness"
//     but does not enumerate every per-option score). Tune in /admin
//     once real submissions arrive.
//   - Risk flag codes are stable so historical reports stay readable.

// ----------------------------------------------------------------------------
// Domain weights — per spec §5.1
// ----------------------------------------------------------------------------

export const DOMAIN_WEIGHTS: DomainWeights = {
  data_foundation: 0.5,
  program_readiness: 0.3,
  org_reality: 0.2,
};

// ----------------------------------------------------------------------------
// Tier boundaries — per spec §5.2
// ----------------------------------------------------------------------------

export const TIER_BOUNDARIES: TierBoundary[] = [
  { tier: "Critical", label: "Foundation Risk", min: 0, max: 25 },
  { tier: "Emerging", label: "Structurally Exposed", min: 26, max: 50 },
  { tier: "Developing", label: "Program-Ready", min: 51, max: 75 },
  { tier: "Advanced", label: "Scale-Ready", min: 76, max: 100 },
];

// ----------------------------------------------------------------------------
// Questions — 12 base + 7 branches per spec §3 + §4
// ----------------------------------------------------------------------------
//
// Domain assignment per spec §5.1 table. Note: Q9 appears in both
// Data Foundation and Program Readiness in the spec table. We assign it
// to Data Foundation since the question content (most-significant AI
// initiative outcome) is fundamentally a data-foundation diagnostic
// surfaced through program output. Tune later if needed.

export const QUESTIONS: Question[] = [
  // ========================================================================
  // Block 1 — Context & Qualification
  // ========================================================================

  {
    id: "q1",
    block: 1,
    domain: "org_reality",
    text: "What sector does your organisation operate in?",
    intent:
      "Flags sweet-spot leads. Tailors regulatory language in the Claude report. Financial services reports reference data lineage obligations. Healthcare reports reference clinical data integrity. Government reports reference APS data governance frameworks.",
    options: [
      { code: "A", label: "Financial services", score: 3 },
      { code: "B", label: "Healthcare and life sciences", score: 3 },
      { code: "C", label: "Government and public sector", score: 2 },
      { code: "D", label: "Energy and utilities", score: 2 },
      { code: "E", label: "Other", score: 1 },
    ],
  },

  {
    id: "q2",
    block: 1,
    domain: "org_reality",
    text: "What best describes your role in AI investment decisions?",
    intent:
      "Qualifies decision-making authority without asking 'are you a decision-maker' directly. 'Owns budget' is the highest-intent signal. 'Building the business case' is a secondary signal — this person will forward the report upward.",
    options: [
      { code: "A", label: "I own the budget and the outcome", score: 3 },
      {
        code: "B",
        label: "I influence the decision but do not hold the budget",
        score: 2,
      },
      {
        code: "C",
        label: "I am building the business case for someone above me",
        score: 1,
      },
      {
        code: "D",
        label: "I am implementing what has already been decided",
        score: 0,
      },
    ],
  },

  {
    id: "q3",
    block: 1,
    domain: "program_readiness",
    text: "Where is your organisation right now with AI?",
    intent:
      "Sets the maturity baseline. Determines whether Q9 is relevant (no pilots = Q9 is replaced). The 'scaling but hitting walls' answer is the highest-urgency lead.",
    options: [
      { code: "A", label: "Still exploring — no firm program yet", score: 0 },
      {
        code: "B",
        label: "We have run pilots but nothing is in production",
        score: 1,
      },
      {
        code: "C",
        label: "We have AI in production but it is not scaling",
        score: 2,
      },
      {
        code: "D",
        label: "We are scaling AI but hitting unexpected walls",
        // Scored 1 not 3 — this is a high-urgency lead signal, but
        // urgency ≠ readiness. Hitting walls means real pain at scale.
        score: 1,
      },
    ],
  },

  // ========================================================================
  // Block 2 — The Gut Punch (Data Diagnostic)
  // ========================================================================

  {
    id: "q4",
    block: 2,
    domain: "data_foundation",
    text: "If I asked your data team to trace your three most important business metrics back to their source systems today — could they do it?",
    intent:
      "The lineage question. Most enterprise organisations fail this. Failing it is the exact problem the Archos Labs Data Architecture service resolves.",
    options: [
      {
        code: "A",
        label: "Yes — we have documented end-to-end lineage",
        score: 3,
      },
      { code: "B", label: "Partially — for some systems but not all", score: 2 },
      {
        code: "C",
        label: "We could reconstruct it but it would take weeks",
        score: 1,
      },
      { code: "D", label: "Honestly, no", score: 0 },
    ],
  },

  {
    id: "q5",
    block: 2,
    domain: "data_foundation",
    text: "How many authoritative sources of truth exist for your organisation's core business data?",
    intent:
      "Exposes the golden record problem. 'Depends on who you ask' is the most common honest answer in enterprise environments and triggers a specific paragraph in the report about reconciliation debt.",
    options: [
      {
        code: "A",
        label: "One — a single authoritative source that everyone trusts",
        score: 3,
      },
      {
        code: "B",
        label: "Two or three — we manage the reconciliation ourselves",
        score: 2,
      },
      {
        code: "C",
        label: "More than three — the answer depends on who you ask",
        score: 1,
      },
      { code: "D", label: "We do not know", score: 0 },
    ],
  },

  {
    id: "q6",
    block: 2,
    domain: "data_foundation",
    text: "Has a data quality or data governance issue ever delayed or killed an AI initiative in your organisation?",
    intent:
      "The direct pain question. If yes, the lead already knows they need Rob. The 'No' answer triggers a follow-up that tests whether this confidence is earned.",
    options: [
      {
        code: "A",
        label: "Yes — it was the primary reason the initiative failed or stalled",
        score: 0,
      },
      {
        code: "B",
        label: "Yes — it was a contributing factor alongside other issues",
        score: 1,
      },
      {
        code: "C",
        label: "Not yet, but it is a risk we are aware of",
        score: 2,
      },
      {
        code: "D",
        label: "No — data has not been an issue for us",
        // Scored 2 not 3 — confidence not yet earned. Q6b (triggered by
        // this answer) does the actual differentiation between earned
        // confidence (Q6b=A) and false confidence based on analytics
        // capability (Q6b=D).
        score: 2,
      },
    ],
  },

  {
    id: "q6a",
    block: 2,
    domain: "data_foundation",
    text: "Was the data quality issue known before the program started, or did it surface during implementation?",
    intent:
      "The single most diagnostic question in the assessment. An org that knew and deprioritised has a culture problem. An org that discovered it at deployment has a visibility problem. 'Still not fully understood' means the post-mortem was never done.",
    branch: { parentQuestionId: "q6", triggerAnswers: ["A"] },
    options: [
      {
        code: "A",
        label: "Known beforehand but deprioritised in favour of getting started",
        score: 1,
      },
      { code: "B", label: "It surfaced during discovery and we adapted", score: 2 },
      {
        code: "C",
        label: "It only became clear at deployment — too late to fix cheaply",
        score: 0,
      },
      { code: "D", label: "It is still not fully understood", score: 0 },
    ],
  },

  {
    id: "q6b",
    block: 2,
    domain: "data_foundation",
    text: "Has your data infrastructure been formally assessed for AI workloads specifically — not just analytics or reporting?",
    intent:
      "Tests whether the confidence in Q6 is earned. 'Assumed it is ready based on analytics capability' is the highest-risk answer — analytics readiness does not equal AI readiness.",
    branch: { parentQuestionId: "q6", triggerAnswers: ["D"] },
    options: [
      {
        code: "A",
        label: "Yes — assessed specifically for AI workloads within the last 12 months",
        score: 3,
      },
      {
        code: "B",
        label: "Yes — but the assessment was for analytics, not AI specifically",
        score: 1,
      },
      { code: "C", label: "No — but we are planning to do this", score: 2 },
      {
        code: "D",
        label: "No — we have assumed it is ready based on our analytics capability",
        score: 0,
      },
    ],
  },

  {
    id: "q7",
    block: 2,
    domain: "data_foundation",
    text: "When your AI model makes an incorrect or unexpected decision, who in your organisation can explain why — and point to the data that caused it?",
    intent:
      "Explainability and accountability in one question. Hits executives hard in regulated sectors. 'Nobody owns this accountability yet' is a governance vacuum that Claude names and connects directly to regulatory risk.",
    options: [
      {
        code: "A",
        label: "Our data team can do this today — we have explainability tooling",
        score: 3,
      },
      { code: "B", label: "We could reconstruct it with effort and time", score: 2 },
      { code: "C", label: "We would have to make educated guesses", score: 1 },
      { code: "D", label: "Nobody owns this accountability yet", score: 0 },
    ],
  },

  {
    id: "q8",
    block: 2,
    domain: "data_foundation",
    text: "How would you honestly describe your organisation's data governance in practice — not on paper?",
    intent:
      "Governance theatre vs governance with teeth. 'Aspirational' is the most common honest answer. The 'Active' answer does not mean the lead is unqualified; Claude pivots to AI-specific governance gaps.",
    options: [
      {
        code: "A",
        label: "Active — it blocks bad decisions and is respected across the business",
        score: 3,
      },
      {
        code: "B",
        label: "Documented — policies exist but are rarely enforced",
        score: 1,
      },
      {
        code: "C",
        label: "Aspirational — we have the documents but not the behaviour",
        // Scored 0 not 1 — "documents without behaviour" is governance
        // theatre. Distinct from Documented (score 1, "policies exist
        // but rarely enforced") which has at least the policy layer.
        score: 0,
      },
      {
        code: "D",
        label: "We do not have a formal data governance function",
        score: 0,
      },
    ],
  },

  {
    id: "q9",
    block: 2,
    domain: "data_foundation",
    text: "What happened to the most significant AI initiative your organisation has run?",
    intent:
      "The truth question. 'Quietly shelved' is where the Archos Labs positioning lands hardest. 'Haven't run one' routes to Q9a via the Q3 branch.",
    options: [
      {
        code: "A",
        label: "It went to production and is delivering the value that was promised",
        score: 3,
      },
      {
        code: "B",
        label: "It delivered insight but stalled when we tried to scale it",
        score: 1,
      },
      { code: "C", label: "It was quietly shelved", score: 0 },
      { code: "D", label: "We have not run a significant AI initiative yet", score: 0 },
    ],
  },

  {
    id: "q9a",
    block: 2,
    domain: "data_foundation",
    text: "What do you believe is your organisation's single biggest barrier to getting AI into production?",
    intent:
      "Pulls forward the self-awareness signal Claude needs when there is no pilot history to reference. An executive who identifies data as the barrier is a high-quality lead.",
    branch: { parentQuestionId: "q3", triggerAnswers: ["A", "B"] },
    options: [
      {
        code: "A",
        label: "Our data is not in a state that would support AI reliably",
        score: 3,
      },
      {
        code: "B",
        label: "We do not have the internal skills to build or operate AI systems",
        score: 1,
      },
      {
        code: "C",
        label: "We cannot get executive commitment or budget allocation",
        score: 1,
      },
      {
        code: "D",
        label: "We do not have clearly defined use cases with measurable outcomes",
        score: 1,
      },
      { code: "E", label: "Budget has not been allocated", score: 0 },
    ],
  },

  {
    id: "q9b",
    block: 2,
    domain: "data_foundation",
    text: "Where specifically are the walls you are hitting?",
    intent:
      "The highest-intent lead answer. This is an organisation in pain right now. Each answer maps to a specific Archos Labs service line.",
    branch: { parentQuestionId: "q3", triggerAnswers: ["D"] },
    options: [
      {
        code: "A",
        label: "Data quality is degrading as volume and variety increase",
        score: 0,
      },
      {
        code: "B",
        label: "Our governance processes cannot keep pace with deployment speed",
        score: 0,
      },
      {
        code: "C",
        label: "Model performance is below expectation in production conditions",
        score: 1,
      },
      { code: "D", label: "Business adoption is low despite technical delivery", score: 1 },
      {
        code: "E",
        label: "The cost of running AI at scale is exceeding the value it delivers",
        score: 0,
      },
    ],
  },

  {
    id: "q9c",
    block: 2,
    domain: "data_foundation",
    text: "What was the primary reason given for shelving the initiative?",
    intent:
      "Reveals whether the organisation has post-mortem discipline. 'Never formally documented' means the same failure will recur.",
    branch: { parentQuestionId: "q9", triggerAnswers: ["C"] },
    options: [
      { code: "A", label: "Data was not ready to support the use case", score: 1 },
      { code: "B", label: "Cost overran the business case", score: 1 },
      {
        code: "C",
        label: "Business priorities shifted and the sponsor moved on",
        score: 1,
      },
      { code: "D", label: "Results did not justify continuation", score: 1 },
      {
        code: "E",
        label: "The reason was never formally documented or discussed",
        score: 0,
      },
    ],
  },

  {
    id: "q9d",
    block: 2,
    domain: "data_foundation",
    text: "Is it delivering the business value that was originally promised in the business case?",
    intent:
      "'Underperforming and we are not sure why' is a lineage and governance problem wearing a performance mask. Claude connects this to data drift, model staleness, or training data quality.",
    branch: { parentQuestionId: "q9", triggerAnswers: ["A"] },
    options: [
      { code: "A", label: "Yes — it is exceeding the original projections", score: 3 },
      { code: "B", label: "Yes — roughly in line with what was promised", score: 2 },
      {
        code: "C",
        label: "Partially — some value but below what was sold to the business",
        score: 1,
      },
      { code: "D", label: "No — it is underperforming and we are not sure why", score: 0 },
    ],
  },

  // ========================================================================
  // Block 3 — The Mirror (Urgency & Accountability)
  // ========================================================================

  {
    id: "q10",
    block: 3,
    domain: "program_readiness",
    text: "Who owns the business outcome of your AI program — not the technology, the outcome?",
    intent:
      "Executive sponsor signal. 'Steering committee' diffuses accountability. 'IT or data team' signals a program with no business mandate. 'Unclear or contested' triggers Q10a.",
    options: [
      {
        code: "A",
        label: "A named executive with personal accountability for delivery",
        score: 3,
      },
      { code: "B", label: "A steering committee with shared accountability", score: 1 },
      { code: "C", label: "The IT or data team", score: 1 },
      { code: "D", label: "Ownership is unclear or contested", score: 0 },
    ],
  },

  {
    id: "q10a",
    block: 3,
    domain: "program_readiness",
    text: "When AI investment decisions need to be made, what typically happens in practice?",
    intent:
      "Reveals the specific flavour of governance vacuum. 'Default to vendor recommendations' is the exact profile of an organisation that has been burned by Big Four padding.",
    branch: { parentQuestionId: "q10", triggerAnswers: ["D"] },
    options: [
      {
        code: "A",
        label: "Decisions get escalated and delayed — no clear authority exists",
        score: 1,
      },
      { code: "B", label: "Different teams make competing or conflicting decisions", score: 1 },
      {
        code: "C",
        label: "Decisions default to vendor recommendations by default",
        score: 0,
      },
      {
        code: "D",
        label: "Decisions simply do not get made in a reasonable timeframe",
        score: 0,
      },
    ],
  },

  {
    id: "q11",
    block: 3,
    domain: "program_readiness",
    text: "How long does a material change to your core data architecture typically take to approve and implement?",
    intent:
      "Predicts program velocity directly. 'Never been done cleanly' is a systemic debt signal that Rob addresses in the Data Architecture service line.",
    options: [
      {
        code: "A",
        label: "Days — we move quickly and have clear approval authority",
        score: 3,
      },
      {
        code: "B",
        label: "Weeks — there is a governance process but it is manageable",
        score: 2,
      },
      { code: "C", label: "Months — approvals are slow and cross-departmental", score: 1 },
      {
        code: "D",
        label: "It has never been done cleanly — it always involves technical debt",
        score: 0,
      },
    ],
  },

  {
    id: "q12",
    block: 3,
    domain: "org_reality",
    text: "What is driving urgency around AI in your organisation right now?",
    intent:
      "Qualification closer. 'Board or regulatory mandate' is the highest-urgency signal — Claude ends the report with a specific call to action referencing the timeline pressure. Sets the urgency_flag on the lead row; 'mandate' triggers is_priority=true on the CRM webhook.",
    options: [
      { code: "A", label: "Competitive pressure — we are falling behind peers", score: 2 },
      {
        code: "B",
        label: "Board or regulatory mandate — we have been directed to act",
        // Scored 2 not 3 — board pressure is the highest LEAD-priority
        // signal (see PRIORITY_TRIGGERS) but a mandate doesn't make the
        // org more AI-ready. The CRM tag captures the urgency
        // separately from the score.
        score: 2,
      },
      {
        code: "C",
        label: "Internal cost reduction targets tied to AI automation",
        score: 2,
      },
      {
        code: "D",
        label: "An internal champion is pushing it without a formal mandate",
        score: 1,
      },
      { code: "E", label: "There is no active urgency yet", score: 0 },
    ],
  },
];

// ----------------------------------------------------------------------------
// Risk flag rules — per spec §5.3
// ----------------------------------------------------------------------------

// Up to 3 flags surface per session per spec; severity-ordered when
// multiple match. Rule order in this array breaks ties when severities
// are equal (earlier = higher priority).
export const RISK_FLAG_RULES: RiskFlagRule[] = [
  {
    code: "no_data_lineage",
    title: "No documented data lineage",
    body: "No documented data lineage exists. AI models built on this foundation cannot be trusted or explained.",
    severity: "critical",
    trigger: [{ questionId: "q4", answer: "D" }],
  },
  {
    code: "prior_failure_unexplained",
    title: "Prior AI failure with unidentified root cause",
    body: "A prior AI initiative failed due to data quality, and the root cause has not been formally identified.",
    severity: "critical",
    trigger: [
      { questionId: "q6", answer: "A" },
      { questionId: "q6a", answer: "D" },
    ],
  },
  {
    code: "no_explainability_owner",
    title: "No explainability accountability",
    body: "No individual or team owns explainability for AI decisions. This is a regulatory liability in regulated sectors.",
    severity: "high",
    trigger: [{ questionId: "q7", answer: "D" }],
  },
  {
    code: "vendor_default_decisioning",
    title: "AI decisions default to vendor",
    body: "AI investment decisions are defaulting to vendor recommendations without internal accountability.",
    severity: "high",
    trigger: [
      { questionId: "q10", answer: "D" },
      { questionId: "q10a", answer: "C" },
    ],
  },
  {
    code: "shelved_no_postmortem",
    title: "Previous initiative shelved without post-mortem",
    body: "A previous AI initiative was shelved without a documented post-mortem. The failure mode is likely to recur.",
    severity: "high",
    trigger: [{ questionId: "q9c", answer: "E" }],
  },
  {
    code: "governance_aspirational",
    title: "Governance exists on paper only",
    body: "Data governance exists on paper but is not enforced in practice.",
    severity: "medium",
    trigger: [{ questionId: "q8", answer: "C" }],
  },
];

// ----------------------------------------------------------------------------
// Priority triggers — set lead.is_priority=true regardless of final tier
// ----------------------------------------------------------------------------
//
// Independent of the readiness score. Captures answers that warrant
// immediate sales outreach even when the org's overall readiness is
// strong (a board-mandated program with a high readiness tier is still
// a hot lead because of timeline pressure on the buyer side). The W2
// scoring engine reads this list, evaluates against session answers,
// and sets lead.is_priority = true on the CRM webhook payload.

export const PRIORITY_TRIGGERS: PriorityTrigger[] = [
  {
    questionId: "q12",
    answer: "B",
    reason:
      "Board or regulatory mandate — buyer is under board / regulator timeline pressure regardless of org maturity. Highest-priority outreach.",
  },
];

// ----------------------------------------------------------------------------
// Helper: lookup tables built once at module load for hot-path use
// ----------------------------------------------------------------------------

export const QUESTIONS_BY_ID: Record<string, Question> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q]),
);

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS_BY_ID[id];
}
