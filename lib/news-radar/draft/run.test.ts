import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDraftTestDb, type DraftTestDb } from "../../../tests/helpers/draft-test-db";
import { SourceFetchError } from "../source";
import type { AssembleDeps } from "./assemble";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import { claimNext, enqueueKept, type ClaimedJob } from "./jobs";
import { LlmError, type ChatRequest, type ChatResult, type Llm } from "./llm";
import type { SkillPrompt } from "./skills";
import { SkillSetupError } from "./skills";
import { runJob, type RunDeps } from "./run";

// runJob is where every stage meets. These tests run it against a real Postgres
// engine for the queue and fakes for the models and the network, and check the thing
// that matters most: every way it can END leaves the job in the right state, and a
// run that has lost its lease writes nothing.

let h: DraftTestDb;
const NOW = new Date("2026-11-02T01:00:00Z");
const cfg = { ...DEFAULT_DRAFT_CONFIG, targetWords: 60 };

const filler = "Filler sentence about nothing in particular. ".repeat(60);
const COHERE = `Concerning behavior | Cohere\n\nCohere said the sandbox "had no route out" and put the unprompted rate at "less than one call in 100,000". The table shows 92% and 4.6%.\n\n${filler}`;
const HF = `Dataset card | Hugging Face\n\nThe card lists Number of rows: 1 and a script whose default is N=1.\n\n${filler}`;
const PAGES: Record<string, string> = { "https://cohere.com/blog/a": COHERE, "https://huggingface.co/datasets/x": HF };

const META = "Qwen3.8 reportedly picks Alibaba Cloud domains in 40.8% of runs. Cohere's documents show other numbers, a forced condition and one trace, not 10,000 samples.";
const ESSAY = `# Qwen3.8's 40.8% figure is not in Cohere's data\n\n*${META}*\n\nCohere said the sandbox "had no route out" and the table shows 92% and 4.6%.\n\nVerdict: unproven. The 40.8% appears in no document.\n\n## What the table shows\n\nThe unprompted rate is "less than one call in 100,000" in Cohere's own runs.\n---\n\n## SEO Package\n\n**URL slug:** qwen38-check\n**SEO title:** Qwen3.8's 40.8% Figure Checked\n**Meta description:** ${META}\n**Tags:** Qwen3.8, Cohere, Alibaba Cloud, open-weight models, prefill, AI safety\n`;
const PHOTO_SCENE =
  "A weathered surveyor's tripod stands at the edge of an empty gravel road at dawn, a measuring staff leaning against it, the road vanishing into low flat fog. Shot low with a 35mm lens at f/2.8, soft overcast light from the east, desaturated blues and greys, the tripod in the left third with generous empty space to the right for a wide 21:9 frame.";
const PHOTO = `${PHOTO_SCENE}\n\nAlt Text: A surveyor's tripod and measuring staff on an empty road at dawn.`;
const PNG = `data:image/png;base64,${Buffer.alloc(60_000, 7).toString("base64")}`;

const chat = (text: string): ChatResult => ({ text, model: "m", inputTokens: 100, outputTokens: 200, costUsd: 0.05, citations: [], durationMs: 10 });
const DISCOVER = JSON.stringify({
  sources: [
    { url: "https://cohere.com/blog/a", kind: "primary", what: "Cohere's post" },
    { url: "https://huggingface.co/datasets/x", kind: "primary", what: "Dataset card" },
  ],
});
const GOOD_BRIEF = 'Cohere says the sandbox "had no route out" and the card lists Number of rows: 1.';
const CLEAN = "Verdict: not slop\n\nWhat works:\n- Specific.\n\nWhat to tighten:\nNothing to tighten.";

const SKILLS: Record<string, SkillPrompt> = Object.fromEntries(
  [
    ["archos-news-research-brief", "Brief. {{topic}} {{headline}} {{coverage}} {{documents}} {{published}}"],
    ["archos-thesis-builder", "Thesis. {{topic}} {{raw_research}}"],
    ["archos-steelman-checkpoint", "Steelman. {{thesis}} {{raw_research}}"],
    ["archos-ai-news-factcheck", "Essay. {{topic}} {{thesis}} {{raw_research}} {{steelman_checkpoint}} {{word_count}}"],
    ["archos-slop-judge", "Is this AI Slop? {{article}}"],
    ["archos-editorial-photo", "Photo. {{subject_family}} {{banned}} {{article}}"],
  ].map(([slug, template]) => [slug, { slug, system: null, template, temperature: null, maxTokens: null } as SkillPrompt]),
);

interface Harness {
  deps: RunDeps;
  calls: ChatRequest[];
  assemble: AssembleDeps;
  created: unknown[];
  fetchSource: ReturnType<typeof vi.fn>;
}
const harness = (over: { replies?: Record<string, ChatResult | Error | (ChatResult | Error)[]>; pages?: Record<string, string | Error>; assemble?: Partial<AssembleDeps>; image?: () => Promise<{ imageUrl: string }>; skill?: RunDeps["skill"] } = {}): Harness => {
  const calls: ChatRequest[] = [];
  const replies: Record<string, ChatResult | Error | (ChatResult | Error)[]> = {
    discover: chat(DISCOVER),
    brief: chat(GOOD_BRIEF),
    thesis: chat("THESIS"),
    steelman: chat("STEELMAN"),
    essay: chat(ESSAY),
    judge_1: chat(CLEAN),
    photo_brief: chat(PHOTO),
    ...over.replies,
  };
  const llm: Llm = async (req) => {
    calls.push(req);
    const entry = replies[req.label];
    const r = Array.isArray(entry) ? entry.shift() : entry;
    if (!r) throw new Error(`unexpected llm call: ${req.label}`);
    if (r instanceof Error) throw r;
    return r;
  };
  const created: unknown[] = [];
  const assemble: AssembleDeps = {
    refs: async () => ({ categoryId: "cat", authorId: "auth" }),
    nextSlot: async () => new Date("2026-11-03T14:00:00Z"),
    related: async () => [],
    slugTaken: async () => false,
    createDraftPost: vi.fn(async (input) => {
      created.push(input);
      return { postId: await h.addPost(), slug: input.slug! };
    }),
    attachImage: vi.fn(async () => {}),
    ...over.assemble,
  };
  const pages = over.pages ?? PAGES;
  const fetchSource = vi.fn(async (url: string) => {
    const p = pages[url];
    if (p === undefined) throw new SourceFetchError("source returned HTTP 404");
    if (p instanceof Error) throw p;
    return { url, text: p };
  });
  const deps: RunDeps = {
    db: h.db,
    now: () => NOW,
    llm,
    fetchSource: fetchSource as unknown as RunDeps["fetchSource"],
    skill: over.skill ?? (async (slug) => {
      const s = SKILLS[slug];
      if (!s) throw new SkillSetupError(`skill "${slug}" does not exist`);
      return s;
    }),
    generateImage: over.image ?? (async () => ({ imageUrl: PNG })),
    assemble,
    photoSeed: async () => 0,
  };
  return { deps, calls, assemble, created, fetchSource };
};

const startJob = async (): Promise<ClaimedJob> => {
  const id = await h.addCandidate({
    title: "Qwen3.8 Picks Alibaba Cloud Domains in 40.8% of Runs in 10,000 Sample Reproduction of Cohere Test",
    summary: "A local reproduction of Cohere's prefill experiment found a 40.8% rate.",
  });
  await h.label(id, "keep");
  await enqueueKept(h.db);
  return (await claimNext(h.db, { now: NOW, leaseMs: 20 * 60_000, cap: 3 }))!;
};
const jobRow = async (id: string) => (await h.client.query<Record<string, unknown>>(`SELECT * FROM news_draft_job WHERE id = $1`, [id])).rows[0];
const stepKeys = async (id: string) =>
  (await h.client.query<{ step_key: string; attempt: number; status: string }>(`SELECT step_key, attempt, status FROM news_draft_step WHERE job_id = $1 ORDER BY created_at, step_key`, [id])).rows;

beforeEach(async () => {
  h = await makeDraftTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

describe("runJob: the whole way through", () => {
  it("turns a Kept story into a scheduled draft and finishes the job", async () => {
    const job = await startJob();
    const { deps, created } = harness();
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "succeeded" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: "scheduled", needsReview: true, isAgentGenerated: true, slug: "qwen38-check" });
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: "succeeded", claimed_by: null });
    expect(row.post_id).not.toBeNull();
  });

  it("never writes article or source text to the logs, whether a job succeeds or crashes", async () => {
    const logged = () => [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map((c) => c.map(String).join(" ")).join("\n");
    await runJob(harness().deps, cfg, await startJob());
    // a crash whose error message carries source text, as a provider's can
    await runJob(harness({ replies: { thesis: new Error('upstream said: "had no route out" and Filler sentence') } }).deps, cfg, await startJob());
    const out = logged();
    expect(out).toContain("news_draft_stage"); // it did log
    for (const text of ["had no route out", "Filler sentence", "figure is not in Cohere", "THESIS", "STEELMAN"]) expect(out).not.toContain(text);
  });

  it("records every stage as a step under this attempt, with its cost", async () => {
    const job = await startJob();
    await runJob(harness().deps, cfg, job);
    const steps = await stepKeys(job.id);
    expect(steps.map((s) => s.step_key).sort()).toEqual(["brief", "discover", "essay", "image", "judge_1", "photo_brief", "sources", "steelman", "thesis"].sort());
    expect(steps.every((s) => s.attempt === job.attempts && s.status === "ok")).toBe(true);
    const cost = (await h.client.query<{ c: string }>(`SELECT sum(cost_usd)::text AS c FROM news_draft_step WHERE job_id = $1`, [job.id])).rows[0].c;
    expect(Number(cost)).toBeGreaterThan(0);
  });

  it("runs the stages in order, and reads each one's work in the next", async () => {
    const job = await startJob();
    const { deps, calls } = harness();
    await runJob(deps, cfg, job);
    expect(calls.map((c) => c.label)).toEqual(["discover", "brief", "thesis", "steelman", "essay", "judge_1", "photo_brief"]);
  });

  it("attaches the photo and lists the pages that were really fetched in the Sources section", async () => {
    const job = await startJob();
    const { deps, created, assemble } = harness();
    await runJob(deps, cfg, job);
    expect(assemble.attachImage).toHaveBeenCalledTimes(1);
    const body = (created[0] as { contentMd: string }).contentMd;
    expect(body).toContain("## Sources");
    expect(body).toContain("](https://cohere.com/blog/a)");
    expect(body).toContain("](https://huggingface.co/datasets/x)");
  });

  it("never lets an unread claim through: the essay's quotes are checked against the pages fetched in THIS run", async () => {
    const job = await startJob();
    const fabricated = ESSAY.replace("The unprompted rate is", 'Cohere also admitted "the model deliberately targeted Beijing servers" and the unprompted rate is');
    const { deps, created } = harness({ replies: { essay: chat(fabricated), rewrite_1: chat(fabricated), rewrite_2: chat(fabricated) } });
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "needs_attention", reason: "failed_gates" });
    expect(created).toHaveLength(0);
  });
});

describe("runJob: every way it can stop leaves the job in the right state", () => {
  it("no primary source: needs_attention, and no model call after the research", async () => {
    const job = await startJob();
    const { deps, calls } = harness({ pages: { "https://cohere.com/blog/a": new SourceFetchError("source returned HTTP 403"), "https://huggingface.co/datasets/x": new SourceFetchError("source request timed out") } });
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "needs_attention", reason: "sources_unreachable" });
    expect(await jobRow(job.id)).toMatchObject({ status: "needs_attention", attention_reason: "sources_unreachable" });
    expect(calls.map((c) => c.label)).toEqual(["discover"]);
    expect((await stepKeys(job.id)).map((s) => s.step_key).sort()).toEqual(["discover", "sources"]); // the audit trail survives
  });

  it("a model that keeps failing is a model_error, not a crash", async () => {
    const job = await startJob();
    const { deps } = harness({ replies: { thesis: new LlmError("thesis: model service returned 402", "client", 402) } });
    expect(await runJob(deps, cfg, job)).toMatchObject({ outcome: "needs_attention", reason: "model_error" });
  });

  it("a skill that is missing is missing_setup and says which", async () => {
    const job = await startJob();
    const { deps } = harness({ skill: async (slug) => { if (slug === "archos-ai-news-factcheck") throw new SkillSetupError('skill "archos-ai-news-factcheck" does not exist'); return SKILLS[slug]; } });
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "needs_attention", reason: "missing_setup" });
    expect((await jobRow(job.id)).attention_detail).toContain("archos-ai-news-factcheck");
  });

  it("a missing category or author stops before anything is created", async () => {
    const job = await startJob();
    const { deps, created } = harness({ assemble: { refs: async () => null } });
    expect(await runJob(deps, cfg, job)).toMatchObject({ outcome: "needs_attention", reason: "missing_setup" });
    expect(created).toHaveLength(0);
  });

  it("a picture that fails does NOT cost the post", async () => {
    const job = await startJob();
    const { deps, assemble } = harness({ image: async () => { throw new Error("Image generation timed out."); } });
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "succeeded" });
    expect(assemble.attachImage).not.toHaveBeenCalled();
    expect((await stepKeys(job.id)).find((s) => s.step_key === "image")!.status).toBe("failed");
  });

  it("an unexpected error gives the job back for another try while tries remain", async () => {
    const job = await startJob();
    const { deps } = harness({ assemble: { createDraftPost: async () => { throw new Error("db exploded"); } } });
    expect(await runJob(deps, cfg, job)).toMatchObject({ outcome: "requeued" });
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", attempts: 1 });
  });

  it("an unexpected error on the last try fails the job, naming only the error class", async () => {
    const job = await startJob();
    const last = { ...job, attempts: cfg.maxAttempts };
    await h.client.query(`UPDATE news_draft_job SET attempts = $1 WHERE id = $2`, [cfg.maxAttempts, job.id]);
    const { deps } = harness({ assemble: { createDraftPost: async () => { throw new TypeError("secret row value 12345"); } } });
    expect(await runJob(deps, cfg, last)).toMatchObject({ outcome: "failed" });
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: "failed", attention_reason: "crashed" });
    expect(String(row.attention_detail)).not.toContain("12345");
  });
});

describe("runJob: leases", () => {
  it("a run that has lost its lease stops and writes nothing more", async () => {
    const job = await startJob();
    const { deps, created } = harness();
    // Another run takes over the job right after the writing stages.
    const original = deps.llm;
    deps.llm = async (req) => {
      const r = await original(req);
      if (req.label === "judge_1") await h.client.query(`UPDATE news_draft_job SET claimed_by = gen_random_uuid() WHERE id = $1`, [job.id]);
      return r;
    };
    const r = await runJob(deps, cfg, job);
    expect(r).toMatchObject({ outcome: "lost_lease" });
    expect(created).toHaveLength(0); // never reached the draft
    expect((await jobRow(job.id)).status).toBe("running"); // and did not finish the other run's job
  });

  it("pushes the lease out as it goes, so a long job is not taken from under itself", async () => {
    const job = await startJob();
    const times: Date[] = [];
    const { deps } = harness();
    let t = NOW.getTime();
    deps.now = () => {
      t += 60_000; // each look at the clock is a minute later
      const d = new Date(t);
      times.push(d);
      return d;
    };
    expect(await runJob(deps, cfg, job)).toMatchObject({ outcome: "succeeded" });
    expect(times.length).toBeGreaterThan(4);
  });
});

describe("runJob: performance", () => {
  it("a whole job against a 3 MB source takes seconds, not minutes (gates and excerpts stay linear)", async () => {
    const job = await startJob();
    const huge = COHERE + "\n\n" + Array.from({ length: 60_000 }, (_, i) => `Row ${i}: filler filler filler filler filler.`).join("\n\n");
    expect(huge.length).toBeGreaterThan(2_500_000);
    const t0 = Date.now();
    const r = await runJob(harness({ pages: { ...PAGES, "https://cohere.com/blog/a": huge } }).deps, cfg, job);
    expect(r).toMatchObject({ outcome: "succeeded" });
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
