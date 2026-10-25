import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeRadarTestDb, type RadarTestDb } from "./helpers/radar-test-db";

// Proves drizzle/0042_news_radar.sql gives the guarantees the radar engine
// leans on: the ownership-conditional score write, one score per key, an
// append-only label order, one tick row per slot, and RESTRICT on the evidence
// tables. Runs the real migration SQL in pglite.

let t: RadarTestDb;

beforeAll(async () => {
  t = await makeRadarTestDb();
});

afterAll(async () => {
  await t.close();
});

let n = 0;
async function candidate(): Promise<string> {
  n += 1;
  const r = await t.client.query<{ id: string }>(
    `INSERT INTO news_candidate (source_url, title, published_at)
     VALUES ($1, $2, now()) RETURNING id`,
    [`https://example.test/item-${n}`, `Item ${n}`],
  );
  return r.rows[0].id;
}

async function rubricVersion(): Promise<number> {
  const r = await t.client.query<{ version: number }>(
    `INSERT INTO news_radar_rubric (config) VALUES ('{}'::jsonb) RETURNING version`,
  );
  return r.rows[0].version;
}

const CLAIM_A = "11111111-1111-4111-8111-111111111111";
const CLAIM_B = "22222222-2222-4222-8222-222222222222";

// The conditional score write the engine uses: the UPDATE is the ownership
// gate, and the INSERT reads from what the UPDATE returned, so a stale owner
// changes nothing and writes no score rows.
async function commitScores(
  id: string,
  claim: string,
  version: number,
): Promise<number> {
  const r = await t.client.query(
    `WITH won AS (
       UPDATE news_candidate
          SET status = 'scored', claimed_by = NULL, claimed_until = NULL, updated_at = now()
        WHERE id = $1 AND claimed_by = $2 AND status = 'scoring'
        RETURNING id)
     INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score, confidence)
     SELECT won.id, $3, v.question_key, v.model, v.score, v.confidence
       FROM won CROSS JOIN (VALUES ('audience_fit', 'jev-1.14.0', 2.5::float8, 0.9::float8),
                                    ('novelty', 'embed', 0.4::float8, NULL::float8))
            AS v(question_key, model, score, confidence)`,
    [id, claim, version],
  );
  return r.affectedRows ?? 0;
}

async function claim(id: string, token: string, until: string) {
  await t.client.query(
    `UPDATE news_candidate SET status = 'scoring', claimed_by = $2, claimed_until = $3, attempts = attempts + 1
      WHERE id = $1`,
    [id, token, until],
  );
}

describe("news_candidate", () => {
  it("rejects a status outside the allowed set", async () => {
    const id = await candidate();
    await expect(
      t.client.query(`UPDATE news_candidate SET status = 'done' WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  it("rejects a scoring row without a claim, and a claim on a non-scoring row", async () => {
    const id = await candidate();
    await expect(
      t.client.query(`UPDATE news_candidate SET status = 'scoring' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(
      t.client.query(
        `UPDATE news_candidate SET claimed_by = $2, claimed_until = now() WHERE id = $1`,
        [id, CLAIM_A],
      ),
    ).rejects.toThrow();
  });

  it("dedupes on source_url", async () => {
    await t.client.query(
      `INSERT INTO news_candidate (source_url, title, published_at) VALUES ('https://example.test/dup', 'A', now())`,
    );
    await expect(
      t.client.query(
        `INSERT INTO news_candidate (source_url, title, published_at) VALUES ('https://example.test/dup', 'B', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe("conditional score write", () => {
  it("writes every score row and flips the status when the claim is the caller's", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    await claim(id, CLAIM_A, "2999-01-01T00:00:00Z");

    expect(await commitScores(id, CLAIM_A, v)).toBe(2);

    const status = await t.client.query<{ status: string; claimed_by: string | null }>(
      `SELECT status, claimed_by FROM news_candidate WHERE id = $1`,
      [id],
    );
    expect(status.rows[0]).toEqual({ status: "scored", claimed_by: null });
  });

  it("discards a stale owner's commit after the claim expired and was reclaimed", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    await claim(id, CLAIM_A, "2000-01-01T00:00:00Z"); // A's claim has expired
    await claim(id, CLAIM_B, "2999-01-01T00:00:00Z"); // B reclaims

    expect(await commitScores(id, CLAIM_A, v)).toBe(0); // A's late commit changes nothing

    const rows = await t.client.query(
      `SELECT 1 FROM news_candidate_score WHERE candidate_id = $1`,
      [id],
    );
    expect(rows.rows).toHaveLength(0);
    const cand = await t.client.query<{ status: string; claimed_by: string }>(
      `SELECT status, claimed_by FROM news_candidate WHERE id = $1`,
      [id],
    );
    expect(cand.rows[0]).toEqual({ status: "scoring", claimed_by: CLAIM_B });

    expect(await commitScores(id, CLAIM_B, v)).toBe(2); // the rightful owner still lands
  });

  it("is a no-op the second time (duplicate commit writes nothing)", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    await claim(id, CLAIM_A, "2999-01-01T00:00:00Z");
    expect(await commitScores(id, CLAIM_A, v)).toBe(2);
    expect(await commitScores(id, CLAIM_A, v)).toBe(0);
  });

  it("refuses a second score for the same item, version, question and model", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    const insert = () =>
      t.client.query(
        `INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score)
         VALUES ($1, $2, 'audience_fit', 'jev-1.14.0', 1)`,
        [id, v],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });
});

describe("evidence is RESTRICTed", () => {
  it("will not delete a candidate that has scores or labels", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    await t.client.query(
      `INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score)
       VALUES ($1, $2, 'audience_fit', 'jev-1.14.0', 1)`,
      [id, v],
    );
    await expect(
      t.client.query(`DELETE FROM news_candidate WHERE id = $1`, [id]),
    ).rejects.toThrow();

    const id2 = await candidate();
    await t.client.query(
      `INSERT INTO news_candidate_label (candidate_id, decision) VALUES ($1, 'keep')`,
      [id2],
    );
    await expect(
      t.client.query(`DELETE FROM news_candidate WHERE id = $1`, [id2]),
    ).rejects.toThrow();
  });

  it("will not delete a rubric version that scores or ticks reference", async () => {
    const id = await candidate();
    const v = await rubricVersion();
    await t.client.query(
      `INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score)
       VALUES ($1, $2, 'audience_fit', 'jev-1.14.0', 1)`,
      [id, v],
    );
    await expect(
      t.client.query(`DELETE FROM news_radar_rubric WHERE version = $1`, [v]),
    ).rejects.toThrow();
  });
});

describe("rubric versions", () => {
  it("assigns strictly increasing versions that cannot be set by hand", async () => {
    const a = await rubricVersion();
    const b = await rubricVersion();
    expect(b).toBeGreaterThan(a);
    await expect(
      t.client.query(`INSERT INTO news_radar_rubric (version, config) VALUES (999, '{}'::jsonb)`),
    ).rejects.toThrow();
  });
});

describe("news_candidate_label", () => {
  it("orders labels by a strictly increasing sequence and only accepts keep, skip or clear", async () => {
    const id = await candidate();
    const ins = (d: string) =>
      t.client.query<{ sequence: string }>(
        `INSERT INTO news_candidate_label (candidate_id, decision) VALUES ($1, $2) RETURNING sequence`,
        [id, d],
      );
    const first = await ins("keep");
    const second = await ins("skip");
    expect(Number(second.rows[0].sequence)).toBeGreaterThan(Number(first.rows[0].sequence));
    await ins("clear");
    await expect(ins("maybe")).rejects.toThrow();

    const latest = await t.client.query<{ decision: string }>(
      `SELECT decision FROM news_candidate_label WHERE candidate_id = $1 ORDER BY sequence DESC LIMIT 1`,
      [id],
    );
    expect(latest.rows[0].decision).toBe("clear");
  });

  it("refuses a repeated request id", async () => {
    const id = await candidate();
    const rid = "33333333-3333-4333-8333-333333333333";
    const ins = () =>
      t.client.query(
        `INSERT INTO news_candidate_label (candidate_id, decision, request_id) VALUES ($1, 'keep', $2)`,
        [id, rid],
      );
    await ins();
    await expect(ins()).rejects.toThrow();
  });
});

describe("news_radar_tick", () => {
  it("allows one row per slot and only the four outcomes", async () => {
    const ins = (slot: string, outcome: string) =>
      t.client.query(
        `INSERT INTO news_radar_tick (slot_at, started_at, finished_at, outcome)
         VALUES ($1, now(), now(), $2)`,
        [slot, outcome],
      );
    await ins("2026-10-26T00:00:00Z", "ok");
    await expect(ins("2026-10-26T00:00:00Z", "failed")).rejects.toThrow();
    await expect(ins("2026-10-26T02:00:00Z", "crashed")).rejects.toThrow();
    for (const [i, o] of ["partial", "failed", "disabled"].entries()) {
      await ins(`2026-10-26T0${4 + i * 2}:00:00Z`, o);
    }
  });
});
