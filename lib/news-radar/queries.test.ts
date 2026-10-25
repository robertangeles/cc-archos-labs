import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRadarTestDb, type RadarTestDb } from "../../tests/helpers/radar-test-db";
import { loadCohortSnapshot, loadRadarPage, loadRadarSummary } from "./queries";
import { RADAR_PAGE_SIZE, type RadarDay, type RadarView } from "./radar-page-types";

// The Radar page's data against real Postgres (pglite): cohort derivation,
// eligibility, the five views, counts, gate progress and the status line. The
// clock, the flag and the Jev key are injected; everything else is the real path.

let t: RadarTestDb;

beforeAll(async () => {
  t = await makeRadarTestDb();
  await t.client.exec(`
    CREATE TABLE site_setting (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
});

afterAll(async () => {
  await t.close();
});

// RESTART IDENTITY so every test sees rubric version 1, 2 and label sequence 1, 2.
beforeEach(async () => {
  await t.client.exec(`
    TRUNCATE news_candidate_score, news_candidate_label, news_candidate,
             news_radar_tick, news_radar_rubric, site_setting RESTART IDENTITY`);
});

// Mon 26 Oct 2026 17:30 AEDT (UTC+11, daylight saving began 4 Oct).
const NOW = new Date("2026-10-26T06:30:00Z");
const PUB = "2026-10-26T01:00:00Z"; // Mon 26 Oct 12:00 AEDT
const SCORED_AT = "2026-10-26T03:00:00Z";

const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await t.client.query<R>(sql, params)).rows;

const RUBRIC_1 = {
  model: "jev-1.14.0",
  questions: {
    audience_fit: {
      instructions: "How useful is this to a data and AI leader in a regulated industry?",
      criteria: ["Irrelevant", "Passing interest", "Useful context", "Directly affects their program"],
    },
  },
  cutoffs: { audienceFit: 2, confidence: 0.6, minNoveltyDistance: 0.3, dailyCap: 2 },
};
const RUBRIC_2 = {
  ...RUBRIC_1,
  cutoffs: { audienceFit: 3, confidence: 0.5, minNoveltyDistance: 0.4, dailyCap: 3 },
};

async function rubric(config: unknown = RUBRIC_1): Promise<number> {
  const r = await q<{ version: number }>(
    `INSERT INTO news_radar_rubric (config) VALUES ($1::jsonb) RETURNING version`,
    [JSON.stringify(config)],
  );
  return r[0].version;
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const numOf = (id: string) => Number(id.slice(-12));

interface Seed {
  n: number;
  pub?: string;
  /** Audience-fit score under version `v`; omit for an item with no score rows. */
  fit?: number;
  conf?: number;
  /** Novelty distance; null = no novelty row (embedding failed). */
  nov?: number | null;
  v?: number;
  at?: string;
  status?: string;
  url?: string;
}

function scoreTuples(s: Seed): string[] {
  if (s.fit === undefined) return [];
  const head = `'${uid(s.n)}', ${s.v ?? 1}`;
  const at = `'${s.at ?? SCORED_AT}'`;
  const rows = [`(${head}, 'audience_fit', 'jev-1.14.0', ${s.fit}, ${s.conf ?? 0.9}, ${at})`];
  if (s.nov !== null) {
    rows.push(`(${head}, 'novelty', 'embedding-nearest-post', ${s.nov ?? 0.8}, NULL, ${at})`);
  }
  return rows;
}

async function insertScores(items: Seed[]) {
  const tuples = items.flatMap(scoreTuples);
  if (tuples.length === 0) return;
  await t.client.exec(
    `INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score, confidence, created_at)
     VALUES ${tuples.join(",")}`,
  );
}

async function seed(...items: Seed[]) {
  const rows = items.map((s) => {
    const status = s.status ?? (s.fit === undefined ? "new" : "scored");
    const claim =
      status === "scoring" ? `'${uid(900)}', '2026-10-26T06:00:00Z'` : "NULL, NULL";
    return `('${uid(s.n)}', '${s.url ?? `https://huggingnews.com/ai/item-${s.n}`}', 'Item ${s.n}', 'Summary ${s.n}', 'ai', '${s.pub ?? PUB}', '${status}', ${claim})`;
  });
  await t.client.exec(
    `INSERT INTO news_candidate (id, source_url, title, summary, category, published_at, status, claimed_by, claimed_until)
     VALUES ${rows.join(",")}`,
  );
  await insertScores(items);
}

/** Extra score rows for an already-seeded item (a rescore under another version). */
const rescore = (s: Seed) => insertScores([s]);

async function label(n: number, decision: "keep" | "skip" | "clear"): Promise<string> {
  const r = await q<{ id: string }>(
    `INSERT INTO news_candidate_label (candidate_id, decision) VALUES ($1, $2) RETURNING id`,
    [uid(n), decision],
  );
  return r[0].id;
}

type Decision = "keep" | "skip" | "clear";
async function labelMany(entries: [number, Decision][]) {
  await t.client.exec(
    `INSERT INTO news_candidate_label (candidate_id, decision)
     VALUES ${entries.map(([n, d]) => `('${uid(n)}', '${d}')`).join(",")}`,
  );
}

async function tick(
  slot: string,
  outcome: "ok" | "partial" | "failed" | "disabled" = "ok",
  o: { finished?: string; err?: string } = {},
) {
  const finished = o.finished ?? new Date(new Date(slot).getTime() + 5 * 60_000).toISOString();
  await q(
    `INSERT INTO news_radar_tick (slot_at, started_at, finished_at, outcome, error_class)
     VALUES ($1::timestamptz, $1::timestamptz, $2::timestamptz, $3, $4)`,
    [slot, finished, outcome, o.err ?? null],
  );
}

/** Every 2-hour slot of one Melbourne day (all in AEDT, UTC+11): 14:00Z the day before + 2h steps. */
function slotsOf(day: string): string[] {
  const [y, m, d] = day.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - 1, 14 + 2 * i)).toISOString(),
  );
}
const fullDay = async (day: string) => {
  for (const slot of slotsOf(day)) await tick(slot);
};

const deps = (over: Record<string, unknown> = {}) => ({
  now: () => NOW,
  hasJevKey: async () => true,
  isEnabled: async () => true,
  ...over,
});
const page = (
  view: RadarView,
  extra: { cohort?: number; page?: number } = {},
  d: Record<string, unknown> = {},
) => loadRadarPage(t.db, { view, ...extra }, deps(d));

const shape = (days: RadarDay[]) =>
  days.map((d) => ({
    day: d.day,
    rows: d.rows.map((r) => numOf(r.id)),
    more: d.more.map((r) => numOf(r.id)),
  }));
const flat = (days: RadarDay[]) => days.flatMap((d) => d.rows.map((r) => numOf(r.id)));

describe("no rubric yet", () => {
  it("returns an empty page for every view without throwing", async () => {
    for (const view of ["to-label", "shortlisted", "kept", "skipped", "all"] as const) {
      const p = await page(view);
      expect(p.cohort).toBeNull();
      expect(p.cohorts).toEqual([]);
      expect(p.days).toEqual([]);
      expect(p.counts).toEqual({ toLabel: 0, shortlisted: 0, kept: 0, skipped: 0, all: 0 });
      expect(p.progress).toMatchObject({
        todayLabelled: 0,
        todayTotal: 0,
        cohortLabelled: 0,
        cohortTarget: 50,
        validDays: 0,
        targetDays: 7,
        gateReady: false,
      });
      expect(p.generatedAt).toBe(NOW.toISOString());
    }
    expect((await page("all")).page).toEqual({ number: 1, pages: 1 });
    expect((await page("to-label")).page).toBeNull();
  });

  it("summary is zero", async () => {
    const s = await loadRadarSummary(t.db, new Date("2026-10-01T00:00:00Z"), deps());
    expect(s.newCount).toBe(0);
  });
});

describe("cohorts", () => {
  it("keeps an item in the cohort of its EARLIEST score row, reading that version's rows only", async () => {
    await rubric(RUBRIC_1);
    await rubric(RUBRIC_2);
    // 1: first scored under v1, rescored under v2 with a poor score.
    await seed({ n: 1, v: 1, fit: 2.5, at: "2026-10-20T01:00:00Z", pub: "2026-10-20T01:00:00Z" });
    await rescore({ n: 1, v: 2, fit: 0.5, at: "2026-10-25T01:00:00Z" });
    // 2: first scored under v2.
    await seed({ n: 2, v: 2, fit: 3, at: "2026-10-25T01:00:00Z" });
    // 3: both versions written at the same instant: the lowest version wins the tie.
    await seed({ n: 3, v: 1, fit: 2.2, at: "2026-10-22T01:00:00Z" });
    await rescore({ n: 3, v: 2, fit: 3, at: "2026-10-22T01:00:00Z" });

    const active = await page("all");
    expect(active.cohort).toEqual({
      version: 2,
      startedAt: "2026-10-25T01:00:00.000Z",
      isActive: true,
    });
    expect(active.cohorts).toEqual([
      { version: 2, startedAt: "2026-10-25T01:00:00.000Z", isActive: true },
      { version: 1, startedAt: "2026-10-20T01:00:00.000Z", isActive: false },
    ]);
    expect(flat(active.days)).toEqual([2]);

    const v1 = await page("all", { cohort: 1 });
    expect(v1.cohort?.version).toBe(1);
    expect(flat(v1.days).sort()).toEqual([1, 3]);
    const one = v1.days.flatMap((d) => d.rows).find((r) => numOf(r.id) === 1);
    expect(one).toMatchObject({
      cohortVersion: 1,
      audienceFit: { score: 2.5, confidence: 0.9 },
      eligible: true,
    });
  });

  it("falls back to the active cohort for an unknown version", async () => {
    await rubric(RUBRIC_1);
    await rubric(RUBRIC_2);
    const p = await page("all", { cohort: 99 });
    expect(p.cohort?.version).toBe(2);
  });

  it("an invalid stored config makes that cohort's items not eligible without throwing", async () => {
    await rubric({ nope: true });
    await seed({ n: 1, fit: 3 }, { n: 2, fit: 3 });
    const all = await page("all");
    expect(all.cohort?.version).toBe(1);
    expect(all.counts).toEqual({ toLabel: 0, shortlisted: 0, kept: 0, skipped: 0, all: 2 });
    expect(all.days.flatMap((d) => d.rows).every((r) => !r.eligible)).toBe(true);
    for (const view of ["to-label", "shortlisted", "kept", "skipped"] as const) {
      expect((await page(view)).days).toEqual([]);
    }
    expect(all.progress).toMatchObject({ cohortLabelled: 0, validDays: 0, gateReady: false });
    const s = await loadRadarSummary(t.db, new Date("2026-10-01T00:00:00Z"), deps());
    expect(s.newCount).toBe(0);
  });

  it("an invalid older cohort does not disturb a valid active one", async () => {
    await rubric({ nope: true });
    await rubric(RUBRIC_1);
    await seed({ n: 1, v: 1, fit: 3, at: "2026-10-20T01:00:00Z" });
    await seed({ n: 2, v: 2, fit: 3, at: "2026-10-25T01:00:00Z" });
    expect(flat((await page("to-label")).days)).toEqual([2]);
    expect((await page("to-label", { cohort: 1 })).days).toEqual([]);
  });
});

describe("eligibility", () => {
  it("is inclusive at the cut-offs and needs novelty", async () => {
    await rubric(); // T 2, C 0.6, M 0.3
    await seed(
      { n: 1, fit: 2, conf: 0.6, nov: 0.3, pub: "2026-10-26T01:00:00Z" }, // exactly on every cut-off
      { n: 2, fit: 1.99, pub: "2026-10-26T02:00:00Z" },
      { n: 3, conf: 0.59, fit: 3, pub: "2026-10-26T03:00:00Z" },
      { n: 4, fit: 3, nov: 0.29, pub: "2026-10-26T04:00:00Z" },
      { n: 5, fit: 3, nov: null, pub: "2026-10-26T05:00:00Z" }, // novelty missing
      { n: 6, fit: 3, pub: "2026-10-26T06:00:00Z" },
    );
    const all = (await page("all")).days.flatMap((d) => d.rows);
    const eligible = Object.fromEntries(all.map((r) => [numOf(r.id), r.eligible]));
    expect(eligible).toEqual({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: true });
    expect(all.find((r) => numOf(r.id) === 5)).toMatchObject({
      audienceFit: { score: 3, confidence: 0.9 },
      noveltyDistance: null,
    });
    expect(flat((await page("to-label")).days).sort()).toEqual([1, 6]);
  });
});

describe("views", () => {
  it("to-label is newest first and not capped", async () => {
    await rubric(); // dailyCap 2
    await seed(
      { n: 1, fit: 3, pub: "2026-10-26T01:00:00Z" },
      { n: 2, fit: 2, pub: "2026-10-26T03:00:00Z" },
      { n: 3, fit: 2, pub: "2026-10-26T03:00:00Z" }, // same instant as 2: id asc
      { n: 4, fit: 2.5, pub: "2026-10-26T05:00:00Z" },
      { n: 5, fit: 2, pub: "2026-10-25T10:00:00Z" }, // Sun 25 Oct 21:00 AEDT
      { n: 6, fit: 2, pub: "2026-10-26T02:00:00Z" },
      { n: 7, fit: 2, pub: "2026-10-26T04:00:00Z" },
      { n: 8, fit: 2, pub: "2026-10-25T14:30:00Z" }, // UTC 25th, but Mon 26 Oct 01:30 in Melbourne
      { n: 9, fit: 1, pub: "2026-10-26T04:30:00Z" }, // not eligible
    );
    await label(6, "keep");
    await label(7, "keep");
    await label(7, "clear");

    const p = await page("to-label");
    expect(shape(p.days)).toEqual([
      { day: "2026-10-26", rows: [4, 7, 2, 3, 1, 8], more: [] },
      { day: "2026-10-25", rows: [5], more: [] },
    ]);
    expect(p.counts.toLabel).toBe(7);
    expect(p.page).toBeNull();
  });

  it("shortlisted applies the daily cap through decide.shortlistView and counts every eligible item", async () => {
    await rubric(); // dailyCap 2
    await seed(
      { n: 1, fit: 3, conf: 0.9, pub: "2026-10-26T01:00:00Z" },
      { n: 2, fit: 3, conf: 0.8, pub: "2026-10-26T02:00:00Z" },
      { n: 3, fit: 2.5, pub: "2026-10-26T03:00:00Z" },
      { n: 4, fit: 2, pub: "2026-10-26T04:00:00Z" },
      { n: 5, fit: 2, pub: "2026-10-25T10:00:00Z" },
      { n: 6, fit: 1, pub: "2026-10-26T05:00:00Z" }, // not eligible
    );
    await label(2, "keep"); // labelled items stay shortlisted

    const p = await page("shortlisted");
    expect(shape(p.days)).toEqual([
      { day: "2026-10-26", rows: [1, 2], more: [3, 4] },
      { day: "2026-10-25", rows: [5], more: [] },
    ]);
    expect(p.counts.shortlisted).toBe(5);
  });

  it("kept and skipped follow each item's current label, in eligible order, uncapped", async () => {
    await rubric(); // dailyCap 2
    await seed(
      { n: 1, fit: 2, pub: "2026-10-26T01:00:00Z" },
      { n: 2, fit: 2.5, pub: "2026-10-26T01:00:00Z" },
      { n: 3, fit: 2, pub: "2026-10-26T02:00:00Z" },
      { n: 4, fit: 2, pub: "2026-10-26T03:00:00Z" },
      { n: 5, fit: 3, pub: "2026-10-26T03:00:00Z" },
      { n: 6, fit: 1, pub: "2026-10-26T04:00:00Z" }, // not eligible, but labelled Keep
      { n: 7, fit: 2, pub: "2026-10-25T10:00:00Z" },
      { n: 8, fit: 2, pub: "2026-10-26T05:00:00Z" },
    );
    await labelMany([
      [1, "keep"],
      [2, "skip"],
      [3, "keep"], // relabelled: ends as skip
      [4, "skip"], // cleared: ends unlabelled
      [5, "keep"],
      [6, "keep"],
      [7, "keep"],
      [8, "keep"],
    ]);
    await labelMany([
      [3, "skip"],
      [4, "clear"],
    ]);

    const kept = await page("kept");
    expect(shape(kept.days)).toEqual([
      { day: "2026-10-26", rows: [5, 8, 1], more: [] }, // fit desc, then publishedAt desc (8 is newer than 1)
      { day: "2026-10-25", rows: [7], more: [] },
    ]);
    const skipped = await page("skipped");
    expect(shape(skipped.days)).toEqual([{ day: "2026-10-26", rows: [2, 3], more: [] }]);

    expect(skipped.counts).toEqual({ toLabel: 1, shortlisted: 7, kept: 4, skipped: 2, all: 8 });
    expect(flat((await page("to-label")).days)).toEqual([4]);
    // The Kept item that is not eligible shows only in All, still carrying its label.
    const six = (await page("all")).days.flatMap((d) => d.rows).find((r) => numOf(r.id) === 6);
    expect(six).toMatchObject({ eligible: false, label: { decision: "keep" } });
  });

  it("scores and labels travel on the row: latestLabelId survives a clear", async () => {
    await rubric();
    await seed(
      { n: 1, fit: 2, pub: "2026-10-26T01:00:00Z" },
      { n: 2, fit: 2, pub: "2026-10-26T02:00:00Z" },
      { n: 3, fit: 2, pub: "2026-10-26T03:00:00Z" },
      { n: 4, pub: "2026-10-26T04:00:00Z" }, // unscored
    );
    const keepId = await label(1, "keep");
    await label(2, "keep");
    const clearId = await label(2, "clear");

    const rows = (await page("all")).days.flatMap((d) => d.rows);
    const by = (n: number) => rows.find((r) => numOf(r.id) === n);
    expect(by(1)).toMatchObject({ label: { id: keepId, decision: "keep" }, latestLabelId: keepId });
    expect(by(2)).toMatchObject({ label: null, latestLabelId: clearId });
    expect(by(3)).toMatchObject({ label: null, latestLabelId: null });
    expect(by(4)).toMatchObject({ label: null, latestLabelId: null });
  });

  it("shows items not scored yet only in All of the active cohort", async () => {
    await rubric(RUBRIC_1);
    await rubric(RUBRIC_2);
    await seed({ n: 1, v: 2, fit: 3 });
    await seed(
      { n: 2, status: "new" },
      { n: 3, status: "scoring" },
      { n: 4, status: "unscored" },
      { n: 5, status: "failed" },
    );

    const all = await page("all");
    expect(all.counts).toMatchObject({ all: 5, toLabel: 1, shortlisted: 1 });
    const rows = all.days.flatMap((d) => d.rows);
    expect(rows.map((r) => numOf(r.id)).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const r of rows.filter((r) => numOf(r.id) > 1)) {
      expect(r).toMatchObject({
        cohortVersion: null,
        eligible: false,
        audienceFit: null,
        noveltyDistance: null,
        label: null,
      });
    }
    expect(rows.find((r) => numOf(r.id) === 3)?.status).toBe("scoring");

    for (const view of ["to-label", "shortlisted", "kept", "skipped"] as const) {
      expect(flat((await page(view)).days).every((n) => n === 1)).toBe(true);
    }
    const old = await page("all", { cohort: 1 });
    expect(old.days).toEqual([]);
    expect(old.counts.all).toBe(0);
  });

  it("paginates All at 50, newest first, grouping days within the page", async () => {
    await rubric();
    // Item n is published n hours before 2026-10-26T12:00Z, so n=1 is newest.
    const base = Date.parse("2026-10-26T12:00:00Z");
    const items: Seed[] = Array.from({ length: RADAR_PAGE_SIZE + 1 }, (_, i) => ({
      n: i + 1,
      fit: i % 2 === 0 ? 3 : 1,
      pub: new Date(base - (i + 1) * 3_600_000).toISOString(),
    }));
    await seed(...items);

    const p1 = await page("all");
    expect(p1.page).toEqual({ number: 1, pages: 2 });
    expect(flat(p1.days)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(p1.days.map((d) => d.day)).toEqual([...p1.days.map((d) => d.day)].sort().reverse());
    expect(p1.days.length).toBeGreaterThan(1);
    expect(p1.counts.all).toBe(51);
    expect(p1.days.some((d) => d.continued)).toBe(false);

    const p2 = await page("all", { page: 2 });
    expect(p2.page).toEqual({ number: 2, pages: 2 });
    expect(flat(p2.days)).toEqual([51]);
    // Items 48..51 are Sat 24 Oct in Melbourne: the day runs across the page break.
    expect(p1.days[p1.days.length - 1].day).toBe("2026-10-24");
    expect(p2.days).toEqual([expect.objectContaining({ day: "2026-10-24", continued: true })]);

    expect((await page("all", { page: 9 })).page).toEqual({ number: 2, pages: 2 });
  });

  it("does not mark a page continued when the previous page ended on an earlier day", async () => {
    await rubric();
    const items: Seed[] = Array.from({ length: RADAR_PAGE_SIZE + 1 }, (_, i) => ({
      n: i + 1,
      fit: 3,
      pub: i < RADAR_PAGE_SIZE ? "2026-10-26T03:00:00Z" : "2026-10-25T03:00:00Z",
    }));
    await seed(...items);
    const p2 = await page("all", { page: 2 });
    expect(p2.days).toHaveLength(1);
    expect(p2.days[0].day).toBe("2026-10-25");
    expect(p2.days[0].continued).toBeFalsy();
    expect((await page("to-label")).days.some((d) => d.continued)).toBe(false);
  });

  it("fills the row fields the list renders", async () => {
    await rubric();
    await seed(
      { n: 1, fit: 3, pub: "2026-10-25T14:30:00Z", url: "https://huggingnews.com/ai/item-1" },
      { n: 2, fit: 3, pub: "2026-10-25T14:00:00Z", url: "not a url" },
    );
    const rows = (await page("to-label")).days.flatMap((d) => d.rows);
    expect(rows[0]).toEqual({
      id: uid(1),
      title: "Item 1",
      summary: "Summary 1",
      category: "ai",
      sourceUrl: "https://huggingnews.com/ai/item-1",
      sourceHost: "huggingnews.com",
      publishedAt: "2026-10-25T14:30:00.000Z",
      day: "2026-10-26",
      status: "scored",
      cohortVersion: 1,
      eligible: true,
      audienceFit: { score: 3, confidence: 0.9 },
      noveltyDistance: 0.8,
      label: null,
      latestLabelId: null,
    });
    expect(rows[1].sourceHost).toBe("");
  });
});

describe("counts and progress", () => {
  it("counts every eligible item in shortlisted whatever the cap", async () => {
    await rubric(); // dailyCap 2
    await seed(
      ...[1, 2, 3, 4].map((n) => ({ n, fit: 3, pub: `2026-10-26T0${n}:00:00Z` })),
      { n: 5, fit: 1 },
      { n: 6, status: "new" },
    );
    await label(1, "keep");
    await label(2, "skip");
    const { counts } = await page("to-label");
    expect(counts).toEqual({ toLabel: 2, shortlisted: 4, kept: 1, skipped: 1, all: 6 });
  });

  it("reports today's labelled share in Melbourne time", async () => {
    await rubric();
    await seed(
      { n: 1, fit: 3, pub: "2026-10-25T14:30:00Z" }, // Mon 26 Oct 01:30 Melbourne: today
      { n: 2, fit: 3, pub: "2026-10-26T05:00:00Z" }, // today
      { n: 3, fit: 3, pub: "2026-10-26T01:00:00Z" }, // today
      { n: 4, fit: 1, pub: "2026-10-26T02:00:00Z" }, // today, not eligible
      { n: 5, fit: 3, pub: "2026-10-25T13:00:00Z" }, // Sun 25 Oct 24:00 -> Mon 00:00 is 13:00Z: today
      { n: 6, fit: 3, pub: "2026-10-25T12:59:00Z" }, // Sun 25 Oct 23:59 Melbourne: yesterday
    );
    await label(1, "keep");
    await label(6, "keep");
    const { progress } = await page("to-label");
    expect(progress.todayTotal).toBe(4);
    expect(progress.todayLabelled).toBe(1);
  });

  it("counts valid days over the cohort's window: full days only, a failed or absent slot voids the day", async () => {
    await rubric();
    await seed({ n: 1, fit: 3, at: "2026-10-20T01:00:00Z", pub: "2026-10-26T01:00:00Z" });
    // Window: Oct 20 (partial first day, no ticks) .. Oct 26 (today, incomplete).
    await fullDay("2026-10-21");
    await fullDay("2026-10-22");
    await fullDay("2026-10-23");
    // Oct 24: one slot failed. Oct 25: one slot never ran.
    for (const [i, slot] of slotsOf("2026-10-24").entries()) {
      await tick(slot, i === 5 ? "failed" : "ok", { err: i === 5 ? "FeedFetchError" : undefined });
    }
    for (const slot of slotsOf("2026-10-25").slice(1)) await tick(slot);
    // A partial tick still counts as run: make Oct 22's first slot partial.
    await q(`UPDATE news_radar_tick SET outcome = 'partial' WHERE slot_at = $1::timestamptz`, [
      slotsOf("2026-10-22")[0],
    ]);

    const { progress } = await page("to-label");
    expect(progress).toMatchObject({ validDays: 3, targetDays: 7, gateReady: false });
  });

  it("is gate-ready only with 50 labelled over 7 valid days, and a clear is not a label", async () => {
    await rubric();
    const items: Seed[] = Array.from({ length: 50 }, (_, i) => ({
      n: i + 1,
      fit: 3,
      at: "2026-10-12T01:00:00Z",
      pub: "2026-10-20T01:00:00Z",
    }));
    await seed(...items);
    await labelMany(items.map((s, i): [number, Decision] => [s.n, i < 30 ? "keep" : "skip"]));
    for (const day of ["13", "14", "15", "16", "17", "18", "19"]) await fullDay(`2026-10-${day}`);

    const ready = await page("kept");
    expect(ready.progress).toEqual({
      todayLabelled: 0,
      todayTotal: 0,
      cohortLabelled: 50,
      cohortTarget: 50,
      validDays: 7,
      targetDays: 7,
      gateReady: true,
    });

    await label(50, "clear");
    const after = await page("kept");
    expect(after.progress).toMatchObject({ cohortLabelled: 49, gateReady: false });
  });

  it("shows zero progress days for a cohort that has not scored anything", async () => {
    await rubric();
    const p = await page("to-label");
    expect(p.cohort).toEqual({ version: 1, startedAt: null, isActive: true });
    expect(p.progress.validDays).toBe(0);
  });
});

describe("status", () => {
  const status = async (d: Record<string, unknown> = {}) => (await page("to-label", {}, d)).status;

  it("off beats no-key beats failing", async () => {
    await rubric();
    await tick("2026-10-26T06:00:00Z", "failed", { err: "JevAuthError" });
    const off = await status({ isEnabled: async () => false, hasJevKey: async () => false });
    expect(off.state).toBe("off");
    const noKey = await status({ hasJevKey: async () => false });
    expect(noKey.state).toBe("no-key");
    expect((await status()).state).toBe("failing");
  });

  it("failing reports the class and slot of the most recent tick", async () => {
    await rubric();
    await tick("2026-10-26T04:00:00Z", "ok", { finished: "2026-10-26T04:05:00Z" });
    await tick("2026-10-26T06:00:00Z", "failed", { err: "JevAuthError", finished: "2026-10-26T06:01:00Z" });
    expect(await status()).toEqual({
      state: "failing",
      lastCheckAt: "2026-10-26T04:05:00.000Z",
      failureClass: "JevAuthError",
      failedSlotAt: "2026-10-26T06:00:00.000Z",
      nextCheckAt: "2026-10-26T08:00:00.000Z",
    });
  });

  it("orders ticks by slot, not by when they finished", async () => {
    await rubric();
    // An old slot retried late (finished after the newest slot) must not count as the latest tick.
    await tick("2026-10-26T02:00:00Z", "failed", { err: "FeedFetchError", finished: "2026-10-26T06:20:00Z" });
    await tick("2026-10-26T04:00:00Z", "ok", { finished: "2026-10-26T04:05:00Z" });
    const s = await status();
    expect(s.state).toBe("healthy");
    expect(s.failureClass).toBeNull();
    expect(s.failedSlotAt).toBeNull();
  });

  it("healthy after an ok or partial tick; lastCheckAt is its finish time", async () => {
    await rubric();
    await tick("2026-10-26T04:00:00Z", "ok", { finished: "2026-10-26T04:05:00Z" });
    await tick("2026-10-26T06:00:00Z", "partial", { finished: "2026-10-26T06:10:00Z" });
    expect(await status()).toEqual({
      state: "healthy",
      lastCheckAt: "2026-10-26T06:10:00.000Z",
      failureClass: null,
      failedSlotAt: null,
      nextCheckAt: "2026-10-26T08:00:00.000Z",
    });
  });

  it("is stale only after MORE than 3 hours without a successful tick", async () => {
    await rubric();
    await tick("2026-10-26T02:00:00Z", "ok", { finished: "2026-10-26T03:30:00.000Z" }); // exactly 3h before NOW
    expect((await status()).state).toBe("healthy");
    await q(`UPDATE news_radar_tick SET finished_at = '2026-10-26T03:29:59.999Z'`);
    expect((await status()).state).toBe("stale");
  });

  it("is stale before any tick has run", async () => {
    await rubric();
    expect(await status()).toMatchObject({ state: "stale", lastCheckAt: null });
  });

  it("does not count a disabled tick as healthy", async () => {
    await rubric();
    await tick("2026-10-26T06:00:00Z", "disabled", { finished: "2026-10-26T06:01:00Z" });
    expect((await status()).state).toBe("stale");
    await tick("2026-10-26T04:00:00Z", "ok", { finished: "2026-10-26T04:05:00Z" });
    // Still the ok tick from 04:05 that makes it healthy, not the disabled one.
    const s = await status();
    expect(s.state).toBe("healthy");
    expect(s.lastCheckAt).toBe("2026-10-26T04:05:00.000Z");
  });

  it("nextCheckAt is the next 2-hour UTC boundary strictly after now", async () => {
    await rubric();
    const at = async (iso: string) =>
      (await page("to-label", {}, { now: () => new Date(iso) })).status.nextCheckAt;
    expect(await at("2026-10-26T06:30:00Z")).toBe("2026-10-26T08:00:00.000Z");
    expect(await at("2026-10-26T08:00:00Z")).toBe("2026-10-26T10:00:00.000Z");
    expect(await at("2026-10-26T07:59:59.999Z")).toBe("2026-10-26T08:00:00.000Z");
    expect(await at("2026-10-26T23:00:00Z")).toBe("2026-10-27T00:00:00.000Z");
  });

  it("reads the radar flag from site_setting by default", async () => {
    await rubric();
    const read = async () =>
      (await loadRadarPage(t.db, { view: "to-label" }, { now: () => NOW, hasJevKey: async () => true }))
        .status.state;
    expect(await read()).toBe("off");
    await q(`INSERT INTO site_setting (key, value) VALUES ('news_radar_enabled', '{"enabled": true}')`);
    expect(await read()).toBe("stale");
  });
});

describe("loadRadarSummary", () => {
  it("counts eligible active-cohort items first scored after `since`", async () => {
    await rubric(RUBRIC_1);
    await rubric(RUBRIC_2);
    const since = new Date("2026-10-26T02:00:00Z");
    await seed(
      { n: 1, v: 2, fit: 3, at: "2026-10-26T02:00:01Z" }, // after: counts
      { n: 2, v: 2, fit: 3, at: "2026-10-26T05:00:00Z" }, // after: counts
      { n: 3, v: 2, fit: 3, at: "2026-10-26T02:00:00Z" }, // exactly `since`: not new
      { n: 4, v: 2, fit: 3, at: "2026-10-26T01:00:00Z" }, // before
      { n: 5, v: 2, fit: 2.9, at: "2026-10-26T05:00:00Z" }, // not eligible
      { n: 6, v: 2, status: "new" }, // unscored
      { n: 7, v: 1, fit: 3, at: "2026-10-20T01:00:00Z" }, // cohort 1
    );
    await rescore({ n: 7, v: 2, fit: 3, at: "2026-10-26T05:00:00Z" }); // rescored later: still cohort 1
    await label(1, "keep"); // a labelled item is still new to the page's data

    const s = await loadRadarSummary(t.db, since, deps());
    expect(s.newCount).toBe(2);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.status.state).toBe("stale");
  });
});

describe("loadCohortSnapshot", () => {
  it("returns the cohort's candidates, every label row, all ticks and the frozen cut-offs", async () => {
    await rubric(RUBRIC_1);
    await rubric(RUBRIC_2);
    await seed(
      { n: 1, v: 1, fit: 2.5, nov: 0.6, at: "2026-10-20T01:00:00Z", pub: "2026-10-19T23:00:00Z" },
      { n: 2, v: 1, fit: 2, nov: null, at: "2026-10-21T01:00:00Z" },
      { n: 3, v: 2, fit: 3, at: "2026-10-25T01:00:00Z" }, // other cohort
      { n: 4, status: "new" }, // unscored
    );
    await rescore({ n: 1, v: 2, fit: 3, at: "2026-10-25T02:00:00Z" });
    await label(1, "keep");
    await label(1, "skip");
    await label(2, "keep");
    await label(3, "keep"); // not this cohort
    await tick("2026-10-26T04:00:00Z", "ok");
    await tick("2026-10-26T06:00:00Z", "failed", { err: "FeedFetchError" });

    const snap = await loadCohortSnapshot(t.db, 1);
    expect(snap.version).toBe(1);
    expect(snap.startedAt).toEqual(new Date("2026-10-20T01:00:00Z"));
    expect(snap.cutoffs).toEqual(RUBRIC_1.cutoffs);
    expect(snap.candidates.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: uid(1),
        publishedAt: new Date("2026-10-19T23:00:00Z"),
        audienceFit: { score: 2.5, confidence: 0.9 },
        noveltyDistance: 0.6,
      },
      {
        id: uid(2),
        publishedAt: new Date(PUB),
        audienceFit: { score: 2, confidence: 0.9 },
        noveltyDistance: null,
      },
    ]);
    expect(snap.titles).toEqual(
      new Map([
        [uid(1), "Item 1"],
        [uid(2), "Item 2"],
      ]),
    );
    expect(snap.labels).toEqual([
      { candidateId: uid(1), sequence: 1, decision: "keep" },
      { candidateId: uid(1), sequence: 2, decision: "skip" },
      { candidateId: uid(2), sequence: 3, decision: "keep" },
    ]);
    expect(typeof snap.labels[0].sequence).toBe("number");
    expect(snap.ticks).toEqual([
      { slotAt: new Date("2026-10-26T04:00:00Z"), outcome: "ok" },
      { slotAt: new Date("2026-10-26T06:00:00Z"), outcome: "failed" },
    ]);
  });

  it("refuses a version that does not exist or whose config is invalid", async () => {
    await rubric({ nope: true });
    await expect(loadCohortSnapshot(t.db, 7)).rejects.toThrow(/version 7/);
    await expect(loadCohortSnapshot(t.db, 1)).rejects.toThrow();
  });
});

describe("a 400-item backlog", () => {
  it("loads each view in a handful of queries and well under 2 seconds", async () => {
    await rubric();
    const base = Date.parse("2026-10-26T05:00:00Z");
    const items: Seed[] = Array.from({ length: 400 }, (_, i) => ({
      n: i + 1,
      fit: [3, 2.5, 2, 1][i % 4],
      pub: new Date(base - i * 25 * 60_000).toISOString(),
    }));
    await seed(...items);
    await labelMany(
      items
        .filter((_, i) => i % 3 === 0)
        .map((s, i): [number, Decision] => [s.n, i % 2 === 0 ? "keep" : "skip"]),
    );
    await fullDay("2026-10-25");

    const spy = vi.spyOn(t.client, "query");
    try {
      for (const view of ["to-label", "shortlisted", "kept", "skipped", "all"] as const) {
        spy.mockClear();
        const started = performance.now();
        const p = await page(view);
        const ms = performance.now() - started;
        expect(ms).toBeLessThan(2000);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(4); // rubrics, cohort starts, ticks, items: no per-row query
        expect(p.counts.all).toBe(400);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
