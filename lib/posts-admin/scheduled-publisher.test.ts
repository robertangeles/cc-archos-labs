import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePostTestDb, type PostTestDb } from "../../tests/helpers/post-test-db";

// MANDATORY REGRESSION SUITE.
//
// publishScheduledPosts had ZERO test coverage before this file, and 5 live
// posts depend on it. Migration 0036 changes its due-row predicate, which is
// the definition of a regression risk: existing behaviour, no coverage, new
// failure mode for existing callers.
//
// The failure mode being guarded: needs_review is a GENERAL editorial flag
// (lib/posts-admin/index.ts:137 exposes it as a list filter; the WordPress
// migration set it on 120 posts). Gating publication on needs_review alone
// would silently stop a human's own flagged-and-scheduled post from ever going
// live. All four combinations are asserted — only the agent-flagged one is
// withheld.

let harness: PostTestDb;

vi.mock("../db", () => ({ getDb: () => harness.db }));
vi.mock("../indexnow", () => ({ pingIndexNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../site-config", () => ({ getSiteUrl: () => "https://archoslabs.xyz" }));

const { publishScheduledPosts } = await import("./scheduled-publisher");

async function statusOf(id: string): Promise<string> {
  const res = await harness.client.query<{ status: string }>(
    `SELECT status FROM "post" WHERE id = $1`,
    [id],
  );
  return res.rows[0].status;
}

describe("publishScheduledPosts — the agent publish gate", () => {
  beforeEach(async () => {
    harness = await makePostTestDb();
  });
  afterEach(async () => {
    await harness.close();
  });

  // --- The four-way matrix. This is the whole point of the file. -----------

  it("publishes a human post that is NOT flagged", async () => {
    const id = await harness.createPost({ isAgentGenerated: false, needsReview: false });
    const r = await publishScheduledPosts(new Date());
    expect(r.published).toBe(1);
    expect(await statusOf(id)).toBe("published");
  });

  it("publishes a human post EVEN IF flagged — behaviour must not change", async () => {
    // The regression this file exists to prevent. An editor scheduling a post
    // and separately flagging it for review must still see it publish, exactly
    // as it did before migration 0036.
    const id = await harness.createPost({ isAgentGenerated: false, needsReview: true });
    const r = await publishScheduledPosts(new Date());
    expect(r.published, "human flagged post must still publish").toBe(1);
    expect(await statusOf(id)).toBe("published");
  });

  it("publishes an agent post once it has been reviewed", async () => {
    const id = await harness.createPost({ isAgentGenerated: true, needsReview: false });
    const r = await publishScheduledPosts(new Date());
    expect(r.published).toBe(1);
    expect(await statusOf(id)).toBe("published");
  });

  it("WITHHOLDS an agent post that is still flagged", async () => {
    const id = await harness.createPost({ isAgentGenerated: true, needsReview: true });
    const r = await publishScheduledPosts(new Date());
    expect(r.processed, "must not even be selected as due").toBe(0);
    expect(r.published).toBe(0);
    expect(await statusOf(id)).toBe("scheduled");
  });

  it("releases a withheld agent post after the flag is cleared", async () => {
    const id = await harness.createPost({ isAgentGenerated: true, needsReview: true });
    expect((await publishScheduledPosts(new Date())).published).toBe(0);

    // The already-shipped "Mark reviewed" action is a PUT with
    // needsReview=false (post-form.tsx:470).
    await harness.client.query(`UPDATE "post" SET needs_review = false WHERE id = $1`, [id]);

    expect((await publishScheduledPosts(new Date())).published).toBe(1);
    expect(await statusOf(id)).toBe("published");
  });

  it("withholds only the flagged agent post in a mixed batch", async () => {
    const human = await harness.createPost({ slug: "a", needsReview: true });
    const agentOk = await harness.createPost({ slug: "b", isAgentGenerated: true });
    const agentHeld = await harness.createPost({
      slug: "c",
      isAgentGenerated: true,
      needsReview: true,
    });

    const r = await publishScheduledPosts(new Date());

    expect(r.published).toBe(2);
    expect(await statusOf(human)).toBe("published");
    expect(await statusOf(agentOk)).toBe("published");
    expect(await statusOf(agentHeld)).toBe("scheduled");
  });

  // --- Pre-existing behaviour that must survive the predicate change -------

  it("ignores a post whose scheduled time has not arrived", async () => {
    const id = await harness.createPost({
      scheduledPublishAt: new Date(Date.now() + 3_600_000),
    });
    const r = await publishScheduledPosts(new Date());
    expect(r.processed).toBe(0);
    expect(await statusOf(id)).toBe("scheduled");
  });

  it("ignores posts that are not in 'scheduled' status", async () => {
    await harness.createPost({ status: "draft" });
    await harness.createPost({ status: "published" });
    const r = await publishScheduledPosts(new Date());
    expect(r.processed).toBe(0);
  });

  it("returns a clean empty result when nothing is due", async () => {
    const r = await publishScheduledPosts(new Date());
    expect(r).toMatchObject({ ok: true, processed: 0, published: 0, failed: 0 });
  });

  it("writes an audit revision attributing the auto-publish", async () => {
    const id = await harness.createPost();
    await publishScheduledPosts(new Date());
    const res = await harness.client.query<{ saved_by: string }>(
      `SELECT saved_by FROM "post_revision" WHERE post_id = $1`,
      [id],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].saved_by).toBe("scheduler-cron");
  });

  it("clears scheduled_publish_at and stamps published_at on publish", async () => {
    const id = await harness.createPost();
    const now = new Date();
    await publishScheduledPosts(now);
    const res = await harness.client.query<{
      scheduled_publish_at: Date | null;
      published_at: Date | null;
    }>(`SELECT scheduled_publish_at, published_at FROM "post" WHERE id = $1`, [id]);
    expect(res.rows[0].scheduled_publish_at).toBeNull();
    expect(res.rows[0].published_at).not.toBeNull();
  });

  it("is idempotent — a second run publishes nothing further", async () => {
    await harness.createPost();
    expect((await publishScheduledPosts(new Date())).published).toBe(1);
    expect((await publishScheduledPosts(new Date())).published).toBe(0);
  });
});
