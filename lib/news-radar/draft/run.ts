// One job, start to finish: research, write, tighten, photograph, assemble. This is
// where the stages meet, and where every way a job can end is decided.
//
//   succeeded        a scheduled draft exists (needs review; it cannot publish itself)
//   needs_attention  a person must look: no verified primary source, a failed check,
//                    a missing skill. The steps already done are kept as the trail.
//   requeued         an unexpected error and tries remain: the job starts over
//   failed           an unexpected error on the last try
//   lost_lease       another run holds the job now. This run writes nothing further.
//
// The lease is pushed out before every stage. A stage that outlives it means another
// run may take the job; the next push then fails and this run stops, rather than
// racing it. Between that last push and the end there is a small window in which a
// slow run and its replacement could both create a post; with one cron worker and a
// 20 minute lease it is a shortcut worth naming, not guarding.

import type { fetchSource as FetchSource } from "../source";
import type { DB } from "../../db";
import { assembleDraft, type AssembleDeps } from "./assemble";
import type { DraftConfig } from "./config";
import { prepareEvidence } from "./essay";
import {
  finishFailed,
  finishNeedsAttention,
  finishSucceeded,
  recordStep,
  renewLease,
  requeueJob,
  type AttentionReason,
  type ClaimedJob,
} from "./jobs";
import type { Llm } from "./llm";
import { runPhoto, type PhotoDeps } from "./photo";
import { runResearch } from "./research";
import { SkillSetupError, type SkillPrompt } from "./skills";
import { tightenEssay } from "./tighten";
import type { StepLog } from "./types";
import { runWriting } from "./write";

export interface RunDeps {
  db: DB;
  now: () => Date;
  llm: Llm;
  fetchSource: typeof FetchSource;
  skill: (slug: string) => Promise<SkillPrompt>;
  generateImage: PhotoDeps["generateImage"];
  assemble: AssembleDeps;
  /** The photo subject rotates on this (posts made so far). */
  photoSeed: () => Promise<number>;
}

export type JobOutcome =
  | { outcome: "succeeded"; postId: string }
  | { outcome: "needs_attention"; reason: AttentionReason }
  | { outcome: "requeued" }
  | { outcome: "failed" }
  | { outcome: "lost_lease" };

class LostLease extends Error {
  override name = "LostLease";
}

export async function runJob(deps: RunDeps, cfg: DraftConfig, job: ClaimedJob): Promise<JobOutcome> {
  const { db } = deps;
  const leaseMs = cfg.leaseMinutes * 60_000;
  const item = { title: job.title, summary: job.summary, publishedAt: job.publishedAt, sourceUrl: job.sourceUrl };
  const stageDeps = { llm: deps.llm, skill: deps.skill };

  const touch = async () => {
    if (!(await renewLease(db, job, deps.now(), leaseMs))) throw new LostLease();
  };
  const record = async (stage: string, started: number, steps: StepLog[]) => {
    for (const s of steps) await recordStep(db, job.id, { ...s, attempt: job.attempts });
    // Counts and timings only: never article or source text in a log line.
    console.log(JSON.stringify({ event: "news_draft_stage", jobId: job.id, stage, durationMs: Date.now() - started, costUsd: steps.reduce((a, s) => a + (s.costUsd ?? 0), 0) }));
  };
  const needsAttention = async (reason: AttentionReason, detail: string): Promise<JobOutcome> => {
    const held = await finishNeedsAttention(db, job, reason, detail, deps.now());
    return held ? { outcome: "needs_attention", reason } : { outcome: "lost_lease" };
  };

  try {
    await touch();
    let t = Date.now();
    const research = await runResearch({ llm: deps.llm, fetchSource: deps.fetchSource, skill: deps.skill }, cfg, item);
    await record("research", t, research.steps);
    if (!research.ok) return needsAttention(research.reason, research.detail);

    await touch();
    t = Date.now();
    const writing = await runWriting(stageDeps, cfg, {
      topic: `Behind the AI Headline: ${job.title}`,
      targetAudience: "Readers who follow AI news and want each headline checked against its primary source",
      research: research.brief,
    });
    await record("write", t, writing.steps);
    if (!writing.ok) return needsAttention(writing.reason, writing.detail);

    await touch();
    t = Date.now();
    const evidence = prepareEvidence(
      research.pages.map((p) => p.text),
      `${job.title}\n${job.summary}`,
      research.brief,
      research.normalized,
    );
    const tight = await tightenEssay(stageDeps, cfg, {
      firstDraft: writing.essay,
      evidence,
      writer: {
        topic: `Behind the AI Headline: ${job.title}`,
        targetAudience: "Readers who follow AI news and want each headline checked against its primary source",
        thesis: writing.thesis,
        research: research.brief,
        steelman: writing.steelman,
        wordCount: cfg.targetWords,
      },
    });
    await record("tighten", t, tight.steps);
    if (!tight.ok) return needsAttention(tight.reason, tight.detail);

    await touch();
    t = Date.now();
    const photo = await runPhoto({ ...stageDeps, generateImage: deps.generateImage }, cfg, {
      article: `# ${tight.parsed.title}\n\n${tight.parsed.body}`,
      seed: await deps.photoSeed(),
    });
    await record("photo", t, photo.steps);

    await touch();
    t = Date.now();
    const assembled = await assembleDraft(deps.assemble, cfg, { parsed: tight.parsed, pages: research.pages, item, photo, now: deps.now() });
    if (!assembled.ok) return needsAttention(assembled.reason, assembled.detail);
    console.log(JSON.stringify({ event: "news_draft_stage", jobId: job.id, stage: "assemble", durationMs: Date.now() - t, imageAttached: assembled.imageAttached, notes: assembled.notes.length }));

    const done = await finishSucceeded(db, job, assembled.postId, deps.now());
    return done ? { outcome: "succeeded", postId: assembled.postId } : { outcome: "lost_lease" };
  } catch (err) {
    if (err instanceof LostLease) return { outcome: "lost_lease" };
    if (err instanceof SkillSetupError) return needsAttention("missing_setup", err.message);
    // The error's name only: a message can carry row values or text from a source.
    const name = err instanceof Error ? err.name : "unknown";
    console.error("[news-draft] job crashed:", name);
    if (job.attempts < cfg.maxAttempts) {
      return (await requeueJob(db, job, deps.now())) ? { outcome: "requeued" } : { outcome: "lost_lease" };
    }
    return (await finishFailed(db, job, "crashed", name, deps.now())) ? { outcome: "failed" } : { outcome: "lost_lease" };
  }
}
