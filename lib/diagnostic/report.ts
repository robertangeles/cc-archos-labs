import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { assessmentSession, reportOutput } from "../db/schema";
import { generateStructured } from "../claude";
import { TIER_BOUNDARIES } from "./content";
import { evaluateSession, evaluatePriorityTriggers } from "./scoring";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import {
  isValidReportContent,
  type ReportContent,
} from "./report-types";
import type { SessionAnswers } from "./flow";
import type { SessionResult } from "./scoring";

// AI Readiness Assessment report orchestrator. Boundary between the
// pure stateless scoring engine + LLM transport (lib/claude.ts) and
// the stateful Postgres layer.
//
// generateReport(): scoring → Claude (via OpenRouter) → DB write
// loadReport():     DB read by session id → ready-to-render shape

const PROMPT_VERSION = "v1";

// Caps Claude's response length. 2000 tokens covers a 500-word
// narrative + verdict + 5-action plan with comfortable headroom.
const MAX_OUTPUT_TOKENS = 2000;

// ----------------------------------------------------------------------------
// generateReport — score, generate, persist, return identifiers
// ----------------------------------------------------------------------------

export interface GenerateReportInput {
  answers: SessionAnswers;
  ipAddress?: string;
  userAgent?: string;
}

export interface GenerateReportResult {
  sessionId: string;
  reportId: string;
}

export async function generateReport(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  // 1. Score the answers (pure)
  const result = evaluateSession(input.answers);

  // 2. Build prompts and call Claude via OpenRouter
  const userPrompt = buildUserPrompt({ answers: input.answers, result });
  const llmResult = await generateStructured<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  if (!isValidReportContent(llmResult.data)) {
    throw new Error(
      "Claude response failed shape validation — verdict/narrative/action_plan missing or malformed",
    );
  }
  const reportContent: ReportContent = llmResult.data;

  // 3. Persist. Two sequential inserts (assessment_session then
  //    report_output). If the second fails we have an orphan session
  //    row with no report — acceptable for W3, fixed in W4 polish via
  //    a Drizzle transaction wrapper.
  const db = getDb();

  const [session] = await db
    .insert(assessmentSession)
    .values({
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
      promptVersion: PROMPT_VERSION,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
    })
    .returning({ id: reportOutput.id });

  if (!report) {
    throw new Error("Insert into report_output returned no row");
  }

  return { sessionId: session.id, reportId: report.id };
}

// ----------------------------------------------------------------------------
// loadReport — read a finished report from the DB ready to render
// ----------------------------------------------------------------------------

export interface LoadedReport {
  sessionId: string;
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
      answers: assessmentSession.answers,
      scores: assessmentSession.scores,
      tier: assessmentSession.tier,
      riskFlags: assessmentSession.riskFlags,
      verdict: reportOutput.verdict,
      narrative: reportOutput.narrative,
      actionPlan: reportOutput.actionPlan,
      generatedAt: reportOutput.generatedAt,
    })
    .from(assessmentSession)
    .innerJoin(
      reportOutput,
      eq(reportOutput.assessmentSessionId, assessmentSession.id),
    )
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

  return {
    sessionId: row.sessionId,
    result,
    content: {
      verdict: row.verdict,
      narrative: row.narrative,
      action_plan: row.actionPlan as ReportContent["action_plan"],
    },
    generatedAt: row.generatedAt,
  };
}
