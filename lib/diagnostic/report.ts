import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { assessmentSession, lead, reportOutput } from "../db/schema";
import { generateStructured } from "../claude";
import { TIER_BOUNDARIES } from "./content";
import { evaluateSession, evaluatePriorityTriggers } from "./scoring";
import { buildUserPrompt } from "./prompts";
import { getDiagnosticPrompt } from "./prompt-config";
import {
  isValidReportContent,
  type ReportContent,
} from "./report-types";
import type { SessionAnswers } from "./flow";
import type { SessionResult } from "./scoring";

// Lead registration data per spec §7.2. Phone optional.
export interface LeadRegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  organisation: string;
  phone?: string;
}

// AI Readiness Assessment report orchestrator. Boundary between the
// pure stateless scoring engine + LLM transport (lib/claude.ts) and
// the stateful Postgres layer.
//
// generateReport(): scoring → Claude (via OpenRouter) → DB write
// loadReport():     DB read by session id → ready-to-render shape

// Caps Claude's response length. 2000 tokens covers a 500-word
// narrative + verdict + 5-action plan with comfortable headroom.
const MAX_OUTPUT_TOKENS = 2000;

// ----------------------------------------------------------------------------
// generateReport — score, generate, persist, return identifiers
// ----------------------------------------------------------------------------

export interface GenerateReportInput {
  answers: SessionAnswers;
  lead: LeadRegistrationInput;
  ipAddress?: string;
  userAgent?: string;
}

export interface GenerateReportResult {
  sessionId: string;
  reportId: string;
  leadId: string;
  /** Scoring + tier + risk flags + priority — surfaced so route-layer
   *  side effects (e.g. lead notification email) don't have to re-run
   *  evaluateSession. */
  result: SessionResult;
}

export async function generateReport(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  // 1. Score the answers (pure)
  const result = evaluateSession(input.answers);

  // 2. Build prompts and call Claude via OpenRouter. The system prompt
  //    loads from the DB (admin-editable) — IP-sensitive practitioner
  //    voice doesn't live in source. Fallback to a generic shell if no
  //    row exists (see prompt-config-shared.ts).
  const { systemPrompt, version: promptVersion } = await getDiagnosticPrompt();
  const userPrompt = buildUserPrompt({ answers: input.answers, result });
  const llmResult = await generateStructured<unknown>({
    systemPrompt,
    userMessage: userPrompt,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  if (!isValidReportContent(llmResult.data)) {
    throw new Error(
      "Claude response failed shape validation — verdict/narrative/action_plan missing or malformed",
    );
  }
  const reportContent: ReportContent = llmResult.data;

  // 3. Persist. Three sequential inserts/upserts:
  //    a. lead — upsert by email so returning users reuse one row
  //    b. assessment_session — links to lead via lead_id
  //    c. report_output — links to session, unique constraint enforced
  //
  //    If any step after lead-upsert fails, we have an orphan lead or
  //    session. Acceptable for W4 Pass 1; W5 polish wraps in a
  //    transaction once Drizzle's transaction surface is ergonomic.
  const db = getDb();

  // Upsert lead by email. Subsequent visits update name/title/org if
  // changed. is_priority is derived from the new session and OR'd —
  // once a lead is flagged priority, they stay priority across
  // future visits (don't downgrade if they later answer Q12 differently).
  const [leadRow] = await db
    .insert(lead)
    .values({
      email: input.lead.email.toLowerCase(),
      firstName: input.lead.firstName,
      lastName: input.lead.lastName,
      jobTitle: input.lead.jobTitle,
      organisation: input.lead.organisation,
      phone: input.lead.phone,
      isPriority: result.isPriority,
    })
    .onConflictDoUpdate({
      target: lead.email,
      set: {
        firstName: input.lead.firstName,
        lastName: input.lead.lastName,
        jobTitle: input.lead.jobTitle,
        organisation: input.lead.organisation,
        phone: input.lead.phone,
        // Sticky: priority flag never downgrades.
        ...(result.isPriority ? { isPriority: true } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ id: lead.id });

  if (!leadRow) {
    throw new Error("Upsert into lead returned no row");
  }

  const [session] = await db
    .insert(assessmentSession)
    .values({
      leadId: leadRow.id,
      answers: input.answers as Record<string, string>,
      scores: result.score,
      tier: result.tier.tier,
      riskFlags: result.riskFlags,
      status: "completed",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      completedAt: new Date(),
    })
    .returning({ id: assessmentSession.id });

  if (!session) {
    throw new Error("Insert into assessment_session returned no row");
  }

  const [report] = await db
    .insert(reportOutput)
    .values({
      assessmentSessionId: session.id,
      verdict: reportContent.verdict,
      narrative: reportContent.narrative,
      actionPlan: reportContent.action_plan,
      modelId: llmResult.modelId,
      promptVersion,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
    })
    .returning({ id: reportOutput.id });

  if (!report) {
    throw new Error("Insert into report_output returned no row");
  }

  return {
    sessionId: session.id,
    reportId: report.id,
    leadId: leadRow.id,
    result,
  };
}

// ----------------------------------------------------------------------------
// loadReport — read a finished report from the DB ready to render
// ----------------------------------------------------------------------------

export interface LoadedReport {
  sessionId: string;
  // The lead that owns this report. Used by the report page to enforce
  // owner-only access (cookie's leadId must match this).
  leadId: string | null;
  // Recipient details — surfaced for the printable cover page so the PDF
  // reads as "Prepared for [Name], [Job title], [Organisation]". Null only
  // when the session predates registration (W3-era reports — should not
  // happen after W4 Pass 1 enforcement).
  recipient: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    organisation: string | null;
  } | null;
  result: SessionResult;
  content: ReportContent;
  generatedAt: Date;
}

export async function loadReport(
  sessionId: string,
): Promise<LoadedReport | null> {
  // UUID format validation: avoid passing invalid strings to Postgres
  // which would throw on the WHERE clause. Cheap regex check.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({
      sessionId: assessmentSession.id,
      leadId: assessmentSession.leadId,
      answers: assessmentSession.answers,
      scores: assessmentSession.scores,
      tier: assessmentSession.tier,
      riskFlags: assessmentSession.riskFlags,
      verdict: reportOutput.verdict,
      narrative: reportOutput.narrative,
      actionPlan: reportOutput.actionPlan,
      generatedAt: reportOutput.generatedAt,
      leadFirstName: lead.firstName,
      leadLastName: lead.lastName,
      leadJobTitle: lead.jobTitle,
      leadOrganisation: lead.organisation,
    })
    .from(assessmentSession)
    .innerJoin(
      reportOutput,
      eq(reportOutput.assessmentSessionId, assessmentSession.id),
    )
    .leftJoin(lead, eq(lead.id, assessmentSession.leadId))
    .where(eq(assessmentSession.id, sessionId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  // Re-derive tier metadata (label) from the stored tier name.
  const tierBoundary =
    TIER_BOUNDARIES.find((t) => t.tier === row.tier) ?? TIER_BOUNDARIES[0];

  // Re-evaluate priority from the persisted answers — cheaper than
  // adding a column to assessment_session, and the rule list lives
  // alongside the questions in lib/diagnostic/content.ts so the result
  // is deterministic.
  const answers = (row.answers ?? {}) as SessionAnswers;
  const priority = evaluatePriorityTriggers(answers);

  const result: SessionResult = {
    score: row.scores as SessionResult["score"],
    tier: tierBoundary,
    riskFlags: (row.riskFlags ?? []) as SessionResult["riskFlags"],
    isPriority: priority.isPriority,
    priorityReasons: priority.reasons,
  };

  const recipient: LoadedReport["recipient"] =
    row.leadFirstName && row.leadLastName
      ? {
          firstName: row.leadFirstName,
          lastName: row.leadLastName,
          jobTitle: row.leadJobTitle,
          organisation: row.leadOrganisation,
        }
      : null;

  return {
    sessionId: row.sessionId,
    leadId: row.leadId,
    recipient,
    result,
    content: {
      verdict: row.verdict,
      narrative: row.narrative,
      action_plan: row.actionPlan as ReportContent["action_plan"],
    },
    generatedAt: row.generatedAt,
  };
}
