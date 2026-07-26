import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, workflowField, workflowStep } from "../db/schema";
import { getEnabledRules, formatRulesForInjection } from "../rules/service";
import { executeStep, executeWorkflow } from "../workflows/executor";
import { createPost } from "../posts-admin";
import {
  attachFallbackImageToPost,
  attachImageToPost,
} from "../posts-admin/attach-image";
import { getBlogAgentConfig, getJudgePrompt, isDueToday, nextPublishSlot } from "./config";
import type { BlogAgentConfig } from "./config-shared";
import { judgeDraft, type JudgeVerdict } from "./judge";
import { generatePostImage } from "./image";
import { parseDraft } from "./parse-draft";
import { pickPlace } from "./parse-image-prompt";
import { slopCheck, type SlopFinding } from "./slop-check";
import {
  claimNextItem,
  releaseItem,
  sweepStaleLocks,
  type ClaimedItem,
} from "./queue";

// The orchestrator: one plan item in, one draft post out.
//
//   sweep stale locks
//        │
//   due today?  ── no ──▶ idle (velocity ramp says not today)
//        │ yes
//   claim one item  ── none ──▶ idle
//        │
//   preflight ── bad config ──▶ fail loudly, never run
//        │
//   executeWorkflow (1 retry — research fails ~1 in 8)
//        │
//   parseDraft ── null ──▶ draft + needs_review, fail item
//        │
//   slopCheck (free, deterministic)
//        │
//   judge (only if the free checks passed — no point paying to
//        │  confirm what a regex already rejected)
//        │
//   pass? ── no ──▶ ONE rewrite of the essay step only ──▶ re-gate
//        │                                                     │
//        │                                            still bad ──▶ draft
//        ▼
//   createPost(scheduled, needs_review, is_agent_generated)
//        │
//   attach illustration ── any failure ──▶ house fallback asset
//
// Nothing here publishes. createPost lands the post as 'scheduled' with
// needs_review set, and the scheduled publisher withholds it until a human
// clears the flag. The worst case for every failure path is a draft plus an
// alert — never a live post.

/** Alt text for the house asset, and for a generated image with no alt. */
const FALLBACK_IMAGE_ALT = "Archos Labs editorial illustration";

/** Cap on rewrite rounds. Deliberately one — see below. */
const MAX_REWRITE_ROUNDS = 1;

export type RunOutcome =
  | "disabled"
  | "not-due"
  | "idle"
  | "drafted"
  | "parked"
  | "failed";

export interface RunResult {
  outcome: RunOutcome;
  itemId?: string;
  postId?: string;
  detail?: string;
  /** True when the post got the house asset instead of its own illustration. */
  imageFallback?: boolean;
  swept?: { reclaimed: number; exhausted: number; exhaustedIds: string[] };
}

export interface PreflightProblem {
  problem: string;
}

/**
 * Verify the config still matches reality before spending anything.
 *
 * The failure this exists for: `syncWorkflowFields` (lib/workflows/service.ts)
 * deletes and re-inserts every field row on save. Ids survive an edit, but
 * deleting and re-adding a field in the builder mints a new random one. The
 * agent would then pass inputs keyed to an id no field has, the research step
 * would receive an empty topic, and it would write a confident, well-formed
 * article about nothing — and that article would look completely normal to
 * every downstream check. Loud failure here is the only place to catch it.
 */
export async function preflight(
  config: BlogAgentConfig,
): Promise<PreflightProblem | null> {
  const db = getDb();

  const steps = await db
    .select({ stepId: workflowStep.stepId })
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, config.workflowId));
  if (steps.length === 0) {
    return { problem: `Workflow ${config.workflowId} has no steps.` };
  }

  const fields = await db
    .select({ fieldId: workflowField.fieldId })
    .from(workflowField)
    .where(eq(workflowField.workflowId, config.workflowId));
  const present = new Set(fields.map((f) => f.fieldId));

  for (const [name, id] of Object.entries(config.fieldMap)) {
    if (!present.has(id)) {
      return {
        problem:
          `Configured field id for "${name}" (${id}) no longer exists on the workflow. ` +
          `A field was probably deleted and re-added in the builder, which mints a new id. ` +
          `Fix the field map at /admin/prompts/blog-agent-config.`,
      };
    }
  }

  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, config.runAsUserId))
    .limit(1);
  if (user.length === 0) {
    return { problem: `runAsUserId ${config.runAsUserId} does not exist.` };
  }

  return null;
}

function inputsFor(config: BlogAgentConfig, item: ClaimedItem): Record<string, string> {
  const band =
    item.format === "long" ? config.wordBands.long : config.wordBands.short;
  const inputs: Record<string, string> = {
    [config.fieldMap.topic]: item.topic,
    [config.fieldMap.audience]: item.audience,
    [config.fieldMap.action]: item.action,
    [config.fieldMap.wordCount]: band,
  };
  // The illustration's setting is rotated here rather than chosen by the art
  // director, which converges hard: three independent runs of the same prompt
  // picked the same setting, every time it was tried. Keyed off dayNumber so
  // consecutive posts differ and a retry of the same item is stable.
  if (config.fieldMap.imagePlace) {
    inputs[config.fieldMap.imagePlace] = pickPlace(item.dayNumber);
  }
  return inputs;
}

interface WorkflowOutput {
  articleDraft: string;
  rawResearch: string;
  /** Empty when the illustration step failed or was removed. */
  imagePrompt: string;
  stepResults: Array<{
    stepId: string;
    outputs: Record<string, string>;
    status: string;
  }>;
}

function collect(stepResults: WorkflowOutput["stepResults"]): WorkflowOutput | null {
  let articleDraft = "";
  let rawResearch = "";
  let imagePrompt = "";
  for (const s of stepResults) {
    if (s.outputs?.article_draft) articleDraft = s.outputs.article_draft;
    if (s.outputs?.raw_research) rawResearch = s.outputs.raw_research;
    if (s.outputs?.image_prompt) imagePrompt = s.outputs.image_prompt;
  }
  // Only the draft is load-bearing. A missing image_prompt costs the post its
  // illustration, not its existence.
  if (!articleDraft) return null;
  return { articleDraft, rawResearch, imagePrompt, stepResults };
}

/**
 * Run the workflow, retrying once on failure.
 *
 * Measured: 1 of 8 historical runs died at the research step with "No response
 * from model" — a provider-side empty response, not a timeout. executeWorkflow
 * stops on the first error with no retry of its own, so unattended that is a
 * ~12% daily failure rate. One retry, then give up.
 */
async function runWorkflowWithRetry(
  config: BlogAgentConfig,
  item: ClaimedItem,
): Promise<{ output: WorkflowOutput | null; error: string | null }> {
  const inputs = inputsFor(config, item);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await executeWorkflow(config.workflowId, config.runAsUserId, inputs);
      const output = collect(res.stepResults as WorkflowOutput["stepResults"]);
      if (output) return { output, error: null };
      const failed = res.stepResults.find((s) => s.status === "error");
      const detail = failed?.error ?? "workflow produced no article_draft";
      if (attempt === 2) return { output: null, error: detail };
      console.warn(`[blog-agent] workflow attempt ${attempt} failed: ${detail}; retrying`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (attempt === 2) return { output: null, error: detail };
      console.warn(`[blog-agent] workflow attempt ${attempt} threw: ${detail}; retrying`);
    }
  }
  return { output: null, error: "unreachable" };
}

/**
 * Re-run ONLY the essay step with the gate's findings as feedback.
 *
 * Reuses the primitive the Regenerate feature already ships
 * (executeStep + feedbackAddendum), so research, thesis and steelman are not
 * re-paid for — about three minutes and a deep-research call saved per rewrite.
 * Deliberately does NOT call amendRun: the persisted run snapshot keeps the
 * original, and nothing downstream reads it.
 */
async function rewriteEssay(
  config: BlogAgentConfig,
  output: WorkflowOutput,
  item: ClaimedItem,
  findings: string,
): Promise<string | null> {
  const db = getDb();
  const steps = await db
    .select()
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, config.workflowId))
    .orderBy(workflowStep.sortOrder);

  const essayIdx = steps.findIndex((s) =>
    output.stepResults.some(
      (r) => r.stepId === s.stepId && r.outputs?.article_draft !== undefined,
    ),
  );
  if (essayIdx === -1) return null;

  // Rebuild the context that step saw: the workflow inputs plus every
  // successful prior step, under both key forms the executor writes.
  const context: Record<string, string> = { ...inputsFor(config, item) };
  for (const r of output.stepResults.slice(0, essayIdx)) {
    for (const [k, v] of Object.entries(r.outputs ?? {})) {
      context[`step_${r.stepId}.${k}`] = v;
      context[`step_${r.stepId}.result`] = v;
    }
  }

  const rules = formatRulesForInjection(await getEnabledRules(config.runAsUserId));
  const { result } = await executeStep(steps[essayIdx], context, rules, {
    userId: config.runAsUserId,
    feedbackAddendum: [
      "An independent editor reviewed your previous draft and rejected it.",
      "Rewrite the piece, fixing every issue below. Do not restate the issues.",
      "",
      findings,
    ].join("\n"),
  });

  return result.status === "success"
    ? (result.outputs.article_draft ?? Object.values(result.outputs)[0] ?? null)
    : null;
}

function describeFindings(gate: SlopFinding[], judge: JudgeVerdict): string {
  const lines: string[] = [];
  for (const f of gate) {
    if (f.severity !== "hard") continue;
    lines.push(`- [${f.tell}] ${f.note}\n  Offending text: "${f.quote}"`);
  }
  for (const f of judge.findings) {
    lines.push(`- [${f.tell}] ${f.why}\n  Offending text: "${f.quote}"`);
  }
  if (judge.failedClosed) {
    lines.push(`- [review-failed] The editor pass could not complete: ${judge.failedClosed}`);
  }
  return lines.join("\n");
}

/** One full pass over the gate. Free checks first; the judge only if they pass. */
async function evaluate(
  config: BlogAgentConfig,
  judgeSystemPrompt: string,
  contentMd: string,
  rawResearch: string,
  fieldNote: string | null,
): Promise<{
  ok: boolean;
  publishable: string;
  gate: SlopFinding[];
  judge: JudgeVerdict;
}> {
  const gate = slopCheck({
    contentMd,
    rawResearch,
    targetWords: { min: 400, max: 1600 },
    fieldNote,
    linkAllowlist: config.linkAllowlist,
    minGroundingRatio: config.minGroundingRatio,
  });

  if (gate.verdict === "reject") {
    // Don't pay the judge to confirm what a regex already decided.
    return {
      ok: false,
      publishable: gate.publishableContentMd,
      gate: gate.findings,
      judge: { verdict: "reject", findings: [] },
    };
  }

  const judge = await judgeDraft({
    contentMd: gate.publishableContentMd,
    rawResearch,
    systemPrompt: judgeSystemPrompt,
    model: config.judgeModel,
  });

  return {
    ok: judge.verdict === "pass",
    publishable: gate.publishableContentMd,
    gate: gate.findings,
    judge,
  };
}

export async function runOnce(now: Date = new Date()): Promise<RunResult> {
  const config = await getBlogAgentConfig();

  // Sweep before anything else: a wedged row from a crashed run blocks nothing
  // by itself, but leaving it stuck is how the pipeline goes quiet unnoticed.
  const swept = await sweepStaleLocks(now);

  if (!config.enabled) return { outcome: "disabled", swept };
  if (!isDueToday(config, now)) return { outcome: "not-due", swept };

  const workerId = randomUUID();
  const item = await claimNextItem(workerId, now);
  if (!item) return { outcome: "idle", swept };

  const problem = await preflight(config);
  if (problem) {
    await releaseItem(item.id, "failed", { lastError: problem.problem });
    return { outcome: "failed", itemId: item.id, detail: problem.problem, swept };
  }

  const { output, error } = await runWorkflowWithRetry(config, item);
  if (!output) {
    const detail = error ?? "workflow failed";
    await releaseItem(item.id, "pending", { lastError: detail });
    return { outcome: "failed", itemId: item.id, detail, swept };
  }

  const judgePrompt = await getJudgePrompt();
  let draft = output.articleDraft;
  let parsed = parseDraft(draft);
  // Every round, not just the last. The first live run needed a rewrite and
  // the reason was unrecoverable afterwards, because this used to be
  // overwritten each iteration — so "why was this rewritten?" had to be
  // reconstructed from workflow_execution_run by hand.
  const rounds: unknown[] = [];

  for (let round = 0; round <= MAX_REWRITE_ROUNDS; round++) {
    if (!parsed) {
      // Unparseable output is a hard stop — publishing a half-parsed post is
      // exactly the silent failure this pipeline exists to prevent.
      break;
    }

    const result = await evaluate(
      config,
      judgePrompt.systemPrompt,
      parsed.contentMd,
      output.rawResearch,
      item.fieldNote,
    );
    rounds.push({ round, gate: result.gate, judge: result.judge });

    if (result.ok) {
      return finish(
        config,
        item,
        parsed,
        result.publishable,
        output.imagePrompt,
        { rounds },
        now,
        swept,
      );
    }

    // One rewrite, then stop. An unbounded loop optimises for evading the
    // judge rather than having something to say, which produces polished
    // emptiness — the precise failure mode being defended against. A second
    // rejection means the research was thin, not the prose.
    if (round === MAX_REWRITE_ROUNDS) break;

    const rewritten = await rewriteEssay(
      config,
      output,
      item,
      describeFindings(result.gate, result.judge),
    );
    if (!rewritten) break;
    draft = rewritten;
    parsed = parseDraft(draft);
  }

  return park(config, item, parsed, draft, { rounds }, swept);
}

/** Passed the gate: land it scheduled, awaiting human review. */
async function finish(
  config: BlogAgentConfig,
  item: ClaimedItem,
  parsed: NonNullable<ReturnType<typeof parseDraft>>,
  publishableContentMd: string,
  imagePrompt: string,
  verdictLog: unknown,
  now: Date,
  swept: RunResult["swept"],
): Promise<RunResult> {
  // createPost runs runSideEffectsAfterSave itself (OG + embedding); calling
  // it again here would double the work and the spend.
  const { post } = await createPost(
    {
      title: parsed.title,
      slug: parsed.slug,
      excerpt: parsed.excerpt,
      // The stripped body, never parsed.contentMd — that one still carries
      // any off-allowlist link the writer was steered into adding.
      contentMd: publishableContentMd,
      seoTitle: parsed.seoTitle,
      seoDescription: parsed.seoDescription,
      tags: parsed.tags,
      authorId: config.authorId,
      // Resolved from the founder-facing category name by plan.ts at insert
      // time, so the mapping is applied once rather than on every run.
      categoryId: item.categoryId,
      status: "scheduled",
      visibility: "listed",
      needsReview: true,
      isAgentGenerated: true,
      // Next 7am in the configured zone. Always in the future, which
      // PostCreateSchema requires. The post still will not go live until the
      // review flag is cleared — this only sets when it becomes eligible.
      scheduledPublishAt: nextPublishSlot(
        now,
        config.publishAt.hour,
        config.publishAt.timeZone,
      ),
    },
    "blog-writer-agent",
  );

  const usedFallback = await attachIllustration(
    config,
    post.id,
    parsed.slug,
    imagePrompt,
  );

  await releaseItem(item.id, "drafted", {
    postId: post.id,
    judgeVerdict: verdictLog,
  });

  return {
    outcome: "drafted",
    itemId: item.id,
    postId: post.id,
    imageFallback: usedFallback,
    swept,
  };
}

/**
 * Give the post its featured image, falling back to the house asset.
 *
 * Runs after `createPost` rather than as part of it because the post must exist
 * before an image can be attached to it, and because an illustration failure
 * must never cost us a good article. Returns whether the fallback was used, so
 * it surfaces in the run output and the reviewer knows to look.
 *
 * `generateOgImage` (lib/og.ts) is still a stub returning an empty path, so
 * without this a post has no image at all and the featured slot renders blank.
 *
 * Exported for its own tests: every branch here ends in a post that either has
 * an illustration or visibly does not, and that is worth checking directly
 * rather than through a whole simulated workflow run.
 */
export async function attachIllustration(
  config: BlogAgentConfig,
  postId: string,
  slug: string,
  imagePrompt: string,
): Promise<boolean> {
  // Two separate try blocks, not one. With a single block, an R2 misconfigured
  // on the server — the likeliest real failure — would throw out of the upload
  // and jump straight past the fallback, and the post would ship with a blank
  // featured slot. Anything that goes wrong above must fall through to below.
  try {
    if (config.image.enabled && imagePrompt.trim()) {
      const image = await generatePostImage(imagePrompt);
      if (image) {
        await attachImageToPost({
          postId,
          slug,
          buffer: image.buffer,
          // The skill's alt is capped at 125 but can be empty, and the title is
          // a poor description of an illustration, so prefer a generic one.
          alt: image.alt || FALLBACK_IMAGE_ALT,
        });
        return false;
      }
    }
  } catch (err) {
    console.warn("[blog-agent] illustration failed, using the house asset:", err);
  }

  try {
    await attachFallbackImageToPost(postId);
  } catch (err) {
    // Last resort. The post is already saved and is still worth reviewing.
    console.warn("[blog-agent] could not attach the house asset either:", err);
  }
  return true;
}

/** Failed the gate twice, or never parsed: land a draft nobody can publish by accident. */
async function park(
  config: BlogAgentConfig,
  item: ClaimedItem,
  parsed: ReturnType<typeof parseDraft>,
  rawDraft: string,
  verdictLog: unknown,
  swept: RunResult["swept"],
): Promise<RunResult> {
  const detail = parsed
    ? "Draft failed the quality gate twice."
    : "Draft could not be parsed into a post.";

  try {
    const { post } = await createPost(
      {
        title: parsed?.title ?? item.title,
        excerpt: parsed?.excerpt ?? null,
        // Keep the raw output when parsing failed — it is the only artefact
        // that explains what went wrong, and a draft is not publishable.
        contentMd: parsed?.contentMd ?? rawDraft,
        tags: parsed?.tags ?? [],
        authorId: config.authorId,
        status: "draft",
        visibility: "listed",
        needsReview: true,
        isAgentGenerated: true,
      },
      "blog-writer-agent",
    );
    await releaseItem(item.id, "failed", {
      postId: post.id,
      lastError: detail,
      judgeVerdict: verdictLog,
    });
    return { outcome: "parked", itemId: item.id, postId: post.id, detail, swept };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseItem(item.id, "failed", {
      lastError: `${detail} Could not save the draft: ${message}`,
      judgeVerdict: verdictLog,
    });
    return { outcome: "failed", itemId: item.id, detail: message, swept };
  }
}
