import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { makeXQueueTestDb, type XQueueTestDb } from "../../tests/helpers/x-queue-test-db";
import { runXArticlesPhase, type XRunDeps } from "./run";

// The runner against a real Postgres engine (pglite) and a fake X: every call to
// api.x.com and to the cover host goes through an injected fetch, so no test can
// reach the real X API. What these tests pin: the Off / Draft / Publish gate and
// the RENDER guard, the failure mapping (including the 503 that burns a draft
// slot), the daily-limit stop, the tick wall, lost fences, and that nothing
// sensitive is ever logged.

const NOW = new Date("2026-11-03T01:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const SITE = "https://archoslabs.test";
const R2 = "https://pub-test.r2.dev";
const COVER_URL = `${R2}/blog/a/a-featured.jpg`;
const KEYS = { apiKey: "k-api-key-1", apiSecret: "s-api-secret-2", accessToken: "t-access-3", accessTokenSecret: "ts-access-secret-4" };

let h: XQueueTestDb;
let coverJpeg: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  h = await makeXQueueTestDb(new Date(NOW.getTime() - HOUR));
  coverJpeg = new Uint8Array(await sharp({ create: { width: 3168, height: 1092, channels: 3, background: "#336699" } }).jpeg().toBuffer());
});
beforeEach(async () => {
  await h.reset();
  vi.stubEnv("R2_PUBLIC_URL", R2);
  vi.stubEnv("RENDER", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

// ---- fake X ---------------------------------------------------------------

type Route = (req: { url: URL; body: unknown }) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

interface Fake {
  fetchImpl: typeof fetch;
  calls: { method: string; host: string; path: string; body: unknown }[];
  count: (path: string) => number;
}

function fakeX(over: Partial<Record<"media" | "draft" | "publish" | "lookup" | "cover", Route>> = {}): Fake {
  const calls: Fake["calls"] = [];
  let drafts = 0;
  const routes: Record<string, Route> = {
    media: () => json(200, { data: { id: "9001", media_key: "3_9001" } }),
    draft: () => json(201, { data: { id: `2117${String(++drafts).padStart(15, "0")}`, title: "t" } }, { "x-user-limit-24hour-remaining": "8" }),
    publish: () => json(200, { data: { post_id: "2118000000000000001" } }, { "x-user-limit-24hour-remaining": "4" }),
    // X finds the post it just published, unless a test says otherwise.
    lookup: ({ url }) => json(200, { data: { id: url.pathname.split("/").pop() } }),
    cover: () => new Response(coverJpeg, { status: 200, headers: { "content-type": "image/jpeg" } }),
    ...over,
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", host: url.host, path: url.pathname, body });
    if (url.host !== "api.x.com") return routes.cover({ url, body });
    if (url.pathname === "/2/media/upload") return routes.media({ url, body });
    if (url.pathname === "/2/articles/draft") return routes.draft({ url, body });
    if (/^\/2\/articles\/\d+\/publish$/.test(url.pathname)) return routes.publish({ url, body });
    if (/^\/2\/tweets\/\d+$/.test(url.pathname)) return routes.lookup({ url, body });
    throw new Error(`unexpected call ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, count: (path) => calls.filter((c) => c.host === "api.x.com" && c.path === path).length };
}

const config = (mode: "off" | "draft" | "publish", over: Record<string, unknown> = {}) => async () =>
  ({
    xArticlesMode: mode,
    xApiKey: KEYS.apiKey,
    xApiSecret: KEYS.apiSecret,
    xAccessToken: KEYS.accessToken,
    xAccessTokenSecret: KEYS.accessTokenSecret,
    ...over,
  }) as Awaited<ReturnType<NonNullable<XRunDeps["readConfig"]>>>;

const tick = (x: Fake, mode: "off" | "draft" | "publish" = "draft", extra: Partial<XRunDeps> = {}, at: Date = NOW) =>
  runXArticlesPhase({ db: h.db, now: () => at, fetchImpl: x.fetchImpl, readConfig: config(mode), siteUrl: SITE, ...extra });

interface Row {
  status: string;
  attempts: number;
  article_id: string | null;
  x_post_id: string | null;
  cover_status: string;
  attention_reason: string | null;
  attention_detail: string | null;
  next_attempt_at: Date;
}
const rowOf = async (postId: string) =>
  (
    await h.client.query<Row>(
      `SELECT status, attempts, article_id, x_post_id, cover_status, attention_reason, attention_detail, next_attempt_at
       FROM x_article_publication WHERE post_id = $1`,
      [postId],
    )
  ).rows[0];
const statuses = async () =>
  (await h.client.query<{ status: string }>(`SELECT status FROM x_article_publication ORDER BY status`)).rows.map((r) => r.status);

const post = (over: Parameters<XQueueTestDb["addPost"]>[0] = {}) =>
  h.addPost({ slug: "a-post", title: "A post title", ogImagePath: COVER_URL, ...over });

// ---- the gate ---------------------------------------------------------------

describe("mode gate", () => {
  it("Off does nothing: no sweep, no claim, no X call, no row", async () => {
    await post();
    const x = fakeX();

    const s = await tick(x, "off");

    expect(s).toMatchObject({ mode: "off", effectiveMode: "off", swept: 0, claimed: 0 });
    expect(x.calls).toEqual([]);
    expect(await statuses()).toEqual([]);
  });

  it.each([
    ["no API key", { xApiKey: null }],
    ["no API secret", { xApiSecret: null }],
    ["no access token", { xAccessToken: null }],
    ["no access token secret", { xAccessTokenSecret: null }],
  ])("throws before any work when %s", async (_label, over) => {
    await post();
    const x = fakeX();

    await expect(
      runXArticlesPhase({ db: h.db, now: () => NOW, fetchImpl: x.fetchImpl, readConfig: config("draft", over), siteUrl: SITE }),
    ).rejects.toThrow("X keys incomplete");
    expect(await statuses()).toEqual([]);
    expect(x.calls).toEqual([]);
  });

  it("lets a config read failure propagate so the route can record it", async () => {
    await expect(
      runXArticlesPhase({ db: h.db, readConfig: async () => Promise.reject(new Error("master key missing")) }),
    ).rejects.toThrow("master key missing");
  });
});

// ---- Draft mode ---------------------------------------------------------------

describe("Draft mode", () => {
  it("makes a draft with the cover and leaves it a draft_only row", async () => {
    const postId = await post();
    const x = fakeX();

    const s = await tick(x);

    expect(s).toMatchObject({ mode: "draft", effectiveMode: "draft", swept: 1, claimed: 1, drafted: 1, published: 0 });
    const r = await rowOf(postId);
    expect(r).toMatchObject({ status: "draft_only", cover_status: "uploaded", x_post_id: null });
    expect(r.article_id).toMatch(/^2117\d+$/);
    expect(x.calls.filter((c) => c.host === "api.x.com").map((c) => c.path)).toEqual(["/2/media/upload", "/2/articles/draft"]);
    expect(x.count("/2/articles/2117000000000000001/publish")).toBe(0);
  });

  it("sends the post's title, a cover_media reference and a backlink to the public post tagged utm_source=x, and no byline", async () => {
    await post({ slug: "my-slug", title: "My Title", contentMd: "Hello **world**." });
    const x = fakeX();

    await tick(x);

    const draft = x.calls.find((c) => c.path === "/2/articles/draft")!.body as {
      title: string;
      cover_media: unknown;
      content_state: { blocks: { text: string }[]; entities: { value: { data: { url?: string } } }[] };
    };
    expect(draft.title).toBe("My Title");
    expect(draft.cover_media).toEqual({ media_id: "9001", media_category: "tweet_image" });
    const texts = draft.content_state.blocks.map((b) => b.text);
    expect(texts[0]).toBe("Hello world.");
    expect(texts.at(-1)).toBe(`Originally published at ${SITE}/blog/my-slug?utm_source=x`);
    expect(texts).not.toContain("Archos Labs");
    expect(draft.content_state.entities.some((e) => e.value.data.url === `${SITE}/blog/my-slug?utm_source=x`)).toBe(true);
  });

  it("uploads a cover cropped to 5:2", async () => {
    await post();
    let uploaded: { media: string } | undefined;
    const x = fakeX({
      media: ({ body }) => {
        uploaded = body as { media: string };
        return json(200, { data: { id: "9001" } });
      },
    });

    await tick(x);

    const meta = await sharp(Buffer.from(uploaded!.media, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([1500, 600]);
  });

  it("a post withdrawn before the claim is skipped and X is never called", async () => {
    const postId = await post();
    await h.client.query(`INSERT INTO x_article_publication (post_id, next_attempt_at) VALUES ($1, $2)`, [postId, NOW]);
    await h.client.query(`UPDATE "post" SET archived_at = now() WHERE id = $1`, [postId]);
    const x = fakeX();

    const s = await tick(x);

    expect(s.skipped).toBe(1);
    expect(await rowOf(postId)).toMatchObject({ status: "skipped", attention_reason: "post_not_public" });
    expect(x.calls).toEqual([]);
  });

  it("a post body the converter refuses goes to needs_attention with no X call", async () => {
    const postId = await post({ contentMd: "| a | b |\n|---|---|\n| 1 | 2 |" });
    const x = fakeX();

    const s = await tick(x);

    expect(s.attention).toBe(1);
    expect(await rowOf(postId)).toMatchObject({ status: "needs_attention", attention_reason: "converter_refused" });
    expect(x.calls).toEqual([]);
  });

  it("does not queue a post published more than 24 hours ago", async () => {
    await post({ publishedAt: new Date(NOW.getTime() - 25 * HOUR) });
    const s = await tick(fakeX());
    expect(s.swept).toBe(0);
    expect(await statuses()).toEqual([]);
  });

  it("takes at most three rows per tick and leaves the rest queued", async () => {
    for (let i = 0; i < 4; i++) await post({ slug: `p-${i}` });
    const x = fakeX();

    const s = await tick(x);

    expect(s).toMatchObject({ swept: 4, claimed: 3, drafted: 3 });
    expect(x.count("/2/articles/draft")).toBe(3);
    expect((await statuses()).sort()).toEqual(["draft_only", "draft_only", "draft_only", "queued"]);
  });

  it("two overlapping ticks make one draft", async () => {
    await post();
    const x = fakeX();

    await Promise.all([tick(x), tick(x)]);

    expect(x.count("/2/articles/draft")).toBe(1);
  });
});

// ---- the cover never blocks the Article ------------------------------------

describe("cover", () => {
  const draftBody = (x: Fake) => x.calls.find((c) => c.path === "/2/articles/draft")!.body as Record<string, unknown>;

  it.each([
    ["the post has no cover", { ogImagePath: null }, "none"],
    ["the cover was deleted", { ogImageDeletedAt: new Date("2026-10-01T00:00:00Z") }, "none"],
  ])("%s: no fetch, no upload, cover_status none", async (_label, over, status) => {
    const postId = await post(over);
    const x = fakeX();

    await tick(x);

    expect(x.calls.map((c) => c.path)).toEqual(["/2/articles/draft"]);
    expect(draftBody(x).cover_media).toBeUndefined();
    expect((await rowOf(postId)).cover_status).toBe(status);
  });

  it.each([
    ["a host other than the R2 bucket", "https://evil.example/cover.jpg"],
    ["a plain-http URL", "http://pub-test.r2.dev/cover.jpg"],
    ["a relative path", "/og/a-post.png"],
    ["a URL with a look-alike host", "https://pub-test.r2.dev.evil.example/cover.jpg"],
  ])("never fetches %s and still drafts without a cover", async (_label, ogImagePath) => {
    const postId = await post({ ogImagePath });
    const x = fakeX();

    await tick(x);

    expect(x.calls.filter((c) => c.host !== "api.x.com")).toEqual([]);
    expect(draftBody(x).cover_media).toBeUndefined();
    expect(await rowOf(postId)).toMatchObject({ status: "draft_only", cover_status: "failed" });
  });

  it.each([
    ["the cover fetch answers 404", { cover: () => new Response("nope", { status: 404 }) }],
    ["the cover is not an image", { cover: () => new Response("not an image", { status: 200 }) }],
    ["the cover is over 5 MB", { cover: () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { status: 200 }) }],
    ["the cover fetch redirects", { cover: () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }) }],
    ["the media upload fails", { media: () => json(500, { title: "boom" }) }],
  ] as const)("%s: drafts without it and records cover_status failed", async (_label, routes) => {
    const postId = await post();
    const x = fakeX(routes);

    await tick(x);

    expect(draftBody(x).cover_media).toBeUndefined();
    expect(await rowOf(postId)).toMatchObject({ status: "draft_only", cover_status: "failed" });
  });
});

// ---- X failures on the draft call -------------------------------------------

describe("draft failures", () => {
  it("401 or 403: needs_attention x_auth, and the rest of the batch is put back untouched", async () => {
    for (let i = 0; i < 3; i++) await post({ slug: `p-${i}` });
    const x = fakeX({ draft: () => json(401, { title: "Unauthorized" }) });

    const s = await tick(x);

    expect(s).toMatchObject({ attention: 1, released: 2, stopped: "auth" });
    expect(x.count("/2/articles/draft")).toBe(1);
    expect((await statuses()).sort()).toEqual(["needs_attention", "queued", "queued"]);
    const r = (await h.client.query<Row>(`SELECT * FROM x_article_publication WHERE status = 'needs_attention'`)).rows[0];
    expect(r.attention_reason).toBe("x_auth");
    const held = (await h.client.query<Row>(`SELECT attempts, next_attempt_at FROM x_article_publication WHERE status = 'queued'`)).rows;
    for (const q of held) {
      expect(q.attempts).toBe(0);
      expect(q.next_attempt_at.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + HOUR);
    }
  });

  it("another 4xx: needs_attention x_rejected carrying only the status and X's error code", async () => {
    const postId = await post();
    const x = fakeX({ draft: () => json(400, { title: "Invalid Request", detail: "SECRETBODY detail", code: 77 }) });

    await tick(x);

    const r = await rowOf(postId);
    expect(r).toMatchObject({ status: "needs_attention", attention_reason: "x_rejected" });
    expect(r.attention_detail).toMatch(/^HTTP 400/);
  });

  it("429: back to queued with X's Retry-After, no attempt counted, and the tick stops", async () => {
    const postId = await post();
    const other = await post({ slug: "other" });
    const x = fakeX({ draft: () => json(429, { title: "Too Many Requests" }, { "retry-after": "1800" }) });

    const s = await tick(x);

    expect(s.stopped).toBe("rate_limited");
    expect(x.count("/2/articles/draft")).toBe(1);
    for (const id of [postId, other]) {
      const r = await rowOf(id);
      expect(r.status).toBe("queued");
      expect(r.attempts).toBe(0);
    }
    const waits = [await rowOf(postId), await rowOf(other)].map((r) => r.next_attempt_at.getTime() - NOW.getTime());
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(30 * MIN);
  });

  it("a 503 counts an attempt, and the third ends in needs_attention (it burns a daily draft slot)", async () => {
    const postId = await post();
    const x = fakeX({ draft: () => json(503, { title: "Service Unavailable" }) });

    await tick(x, "draft", {}, NOW);
    expect(await rowOf(postId)).toMatchObject({ status: "queued", attempts: 1 });
    await tick(x, "draft", {}, new Date(NOW.getTime() + 10 * MIN));
    expect(await rowOf(postId)).toMatchObject({ status: "queued", attempts: 2 });
    await tick(x, "draft", {}, new Date(NOW.getTime() + 30 * MIN));

    expect(await rowOf(postId)).toMatchObject({ status: "needs_attention", attempts: 3, attention_reason: "attempts_exhausted" });
    expect(x.count("/2/articles/draft")).toBe(3);
  });

  it("not due again before its backoff", async () => {
    await post();
    const x = fakeX({ draft: () => json(503, { title: "Service Unavailable" }) });

    await tick(x);
    await tick(x, "draft", {}, new Date(NOW.getTime() + 30_000));

    expect(x.count("/2/articles/draft")).toBe(1);
  });

  it("a network error is transient and does not count an attempt", async () => {
    const postId = await post();
    const x = fakeX({
      draft: () => {
        throw new TypeError("fetch failed");
      },
    });

    await tick(x);

    expect(await rowOf(postId)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("a draft that was made but whose row was taken over stops: nothing more is written or sent", async () => {
    const postId = await post();
    const x = fakeX({
      draft: async () => {
        await h.client.query(`UPDATE x_article_publication SET claimed_by = gen_random_uuid() WHERE post_id = $1`, [postId]);
        return json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": "8" });
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const s = await tick(x, "publish");

    expect(s).toMatchObject({ drafted: 0, published: 0 });
    expect(x.calls.filter((c) => c.host === "api.x.com").map((c) => c.path)).toEqual(["/2/media/upload", "/2/articles/draft"]);
    expect(await rowOf(postId)).toMatchObject({ status: "working", article_id: null });
  });
});

// ---- the daily draft limit ------------------------------------------------------

describe("daily draft limit", () => {
  const withRemaining = (n: string) => ({
    draft: () => json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": n }),
  });

  it("stops draining when 2 or fewer draft calls are left and holds the rest for an hour", async () => {
    for (let i = 0; i < 3; i++) await post({ slug: `p-${i}` });
    const x = fakeX(withRemaining("2"));

    const s = await tick(x);

    expect(s).toMatchObject({ drafted: 1, released: 2, stopped: "daily_limit" });
    expect(x.count("/2/articles/draft")).toBe(1);
    const held = (await h.client.query<Row>(`SELECT attempts, next_attempt_at FROM x_article_publication WHERE status = 'queued'`)).rows;
    expect(held).toHaveLength(2);
    for (const q of held) {
      expect(q.attempts).toBe(0);
      expect(q.next_attempt_at.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + HOUR);
    }
  });

  it("keeps draining while 3 or more are left", async () => {
    for (let i = 0; i < 3; i++) await post({ slug: `p-${i}` });
    const s = await tick(fakeX(withRemaining("3")));
    expect(s).toMatchObject({ drafted: 3, stopped: null });
  });

  it("also stops on the remaining count of a refused draft", async () => {
    for (let i = 0; i < 2; i++) await post({ slug: `p-${i}` });
    const x = fakeX({ draft: () => json(503, { title: "Service Unavailable" }, { "x-user-limit-24hour-remaining": "1" }) });

    const s = await tick(x);

    expect(s.stopped).toBe("daily_limit");
    expect(x.count("/2/articles/draft")).toBe(1);
  });
});

// ---- the tick wall --------------------------------------------------------------

describe("tick wall", () => {
  it("puts the remaining rows back without counting an attempt when the 55 s budget is spent", async () => {
    for (let i = 0; i < 2; i++) await post({ slug: `p-${i}` });
    let t = NOW.getTime();
    const x = fakeX({
      draft: () => {
        t += 60_000; // a slow X
        return json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": "8" });
      },
    });

    const s = await tick(x, "draft", { now: () => new Date(t) });

    expect(s).toMatchObject({ drafted: 1, released: 1, stopped: "tick_wall" });
    expect(x.count("/2/articles/draft")).toBe(1);
    expect((await statuses()).sort()).toEqual(["draft_only", "queued"]);
    expect((await h.client.query<Row>(`SELECT attempts FROM x_article_publication WHERE status = 'queued'`)).rows[0].attempts).toBe(0);
  });

  it("passes each call a timeout of at most 15 s and never more than the time left", async () => {
    await post();
    const seen: number[] = [];
    const realSignal = AbortSignal.timeout;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      seen.push(ms);
      return realSignal.call(AbortSignal, ms);
    });

    await tick(fakeX());

    expect(seen.length).toBeGreaterThan(0);
    for (const ms of seen) expect(ms).toBeLessThanOrEqual(15_000);
  });
});

// ---- Publish mode ---------------------------------------------------------------

describe("Publish mode", () => {
  it("on Render: drafts, then publishes, and records the X post id", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX();

    const s = await tick(x, "publish");

    expect(s).toMatchObject({ mode: "publish", effectiveMode: "publish", drafted: 0, published: 1 });
    expect(await rowOf(postId)).toMatchObject({ status: "published", x_post_id: "2118000000000000001" });
    expect(x.calls.filter((c) => c.host === "api.x.com").map((c) => c.path)).toEqual([
      "/2/media/upload",
      "/2/articles/draft",
      "/2/articles/2117000000000000001/publish",
      "/2/tweets/2118000000000000001",
    ]);
  });

  it.each([
    ["RENDER is unset", undefined],
    ["RENDER is empty", ""],
    ["RENDER is 1", "1"],
    ["RENDER is TRUE", "TRUE"],
  ])("never publishes when %s: runs as Draft and says so", async (_label, render) => {
    vi.stubEnv("RENDER", render);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const postId = await post();
    const x = fakeX();

    const s = await tick(x, "publish");

    expect(s).toMatchObject({ mode: "publish", effectiveMode: "draft", published: 0, drafted: 1 });
    expect(x.calls.some((c) => c.path.endsWith("/publish"))).toBe(false);
    expect((await rowOf(postId)).status).toBe("draft_only");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never publishes in Draft mode even on Render", async () => {
    vi.stubEnv("RENDER", "true");
    await post();
    const x = fakeX();

    await tick(x, "draft");

    expect(x.calls.some((c) => c.path.endsWith("/publish"))).toBe(false);
  });

  it("publish answer lost (5xx): needs_attention publish_ambiguous, and it is never sent again", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX({ publish: () => json(500, { title: "Internal" }) });

    const s = await tick(x, "publish");
    await tick(x, "publish", {}, new Date(NOW.getTime() + 3 * HOUR));

    expect(s.attention).toBe(1);
    expect(await rowOf(postId)).toMatchObject({ status: "needs_attention", attention_reason: "publish_ambiguous" });
    expect(x.count("/2/articles/2117000000000000001/publish")).toBe(1);
  });

  it("publish timeout (network error) is ambiguous too", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX({
      publish: () => {
        throw new TypeError("fetch failed");
      },
    });

    await tick(x, "publish");

    expect(await rowOf(postId)).toMatchObject({ status: "needs_attention", attention_reason: "publish_ambiguous" });
  });

  it("publish 401 and 400 map to x_auth and x_rejected", async () => {
    vi.stubEnv("RENDER", "true");
    const a = await post({ slug: "a" });
    await tick(fakeX({ publish: () => json(403, { title: "Forbidden" }) }), "publish");
    expect(await rowOf(a)).toMatchObject({ status: "needs_attention", attention_reason: "x_auth" });

    await h.reset();
    const b = await post({ slug: "b" });
    await tick(fakeX({ publish: () => json(400, { title: "Invalid" }) }), "publish");
    expect(await rowOf(b)).toMatchObject({ status: "needs_attention", attention_reason: "x_rejected" });
  });

  it("publish 429 puts the draft back (drafted), and a later tick publishes it without a second draft", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    let limited = true;
    const x = fakeX({
      publish: () =>
        limited ? json(429, { title: "Too Many Requests" }, { "retry-after": "600" }) : json(200, { data: { post_id: "2118000000000000009" } }),
    });

    const s = await tick(x, "publish");
    expect(s.stopped).toBe("rate_limited");
    expect(await rowOf(postId)).toMatchObject({ status: "drafted", attempts: 0, article_id: "2117000000000000001" });

    limited = false;
    await tick(x, "publish", {}, new Date(NOW.getTime() + 30 * MIN));

    expect(await rowOf(postId)).toMatchObject({ status: "published", x_post_id: "2118000000000000009" });
    expect(x.count("/2/articles/draft")).toBe(1);
  });

  it("a drafted row left by an earlier tick is published without making a new draft", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    await h.client.query(`INSERT INTO x_article_publication (post_id, status, article_id, next_attempt_at) VALUES ($1, 'drafted', '2117000000000000042', $2)`, [postId, NOW]);
    const x = fakeX();

    await tick(x, "publish");

    expect(x.calls.filter((c) => c.host === "api.x.com").map((c) => c.path)).toEqual([
      "/2/articles/2117000000000000042/publish",
      "/2/tweets/2118000000000000001",
    ]);
    expect((await rowOf(postId)).status).toBe("published");
  });

  it("Draft mode leaves a drafted row alone", async () => {
    const postId = await post();
    await h.client.query(`INSERT INTO x_article_publication (post_id, status, article_id, next_attempt_at) VALUES ($1, 'drafted', '2117000000000000042', $2)`, [postId, NOW]);
    const x = fakeX();

    await tick(x, "draft");

    expect(x.calls).toEqual([]);
    expect((await rowOf(postId)).status).toBe("drafted");
  });

  it("stops after a publish when 1 or fewer publishes are left today", async () => {
    vi.stubEnv("RENDER", "true");
    for (let i = 0; i < 2; i++) await post({ slug: `p-${i}` });
    const x = fakeX({ publish: () => json(200, { data: { post_id: "2118000000000000001" } }, { "x-user-limit-24hour-remaining": "1" }) });

    const s = await tick(x, "publish");

    expect(s).toMatchObject({ published: 1, released: 1, stopped: "daily_limit" });
    expect(x.calls.filter((c) => c.path.endsWith("/publish"))).toHaveLength(1);
  });

  it("a post withdrawn between the draft and the publish is skipped and never published", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX({
      draft: async () => {
        await h.client.query(`UPDATE "post" SET archived_at = now() WHERE id = $1`, [postId]);
        return json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": "8" });
      },
    });

    const s = await tick(x, "publish");

    expect(s.skipped).toBe(1);
    expect(x.calls.some((c) => c.path.endsWith("/publish"))).toBe(false);
    expect((await rowOf(postId)).status).toBe("skipped");
  });

  it("after a 60 s draft, publish waits for the next tick instead of sending on a spent budget", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    let t = NOW.getTime();
    const x = fakeX({
      draft: () => {
        t += 60_000;
        return json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": "8" });
      },
    });

    const s = await tick(x, "publish", { now: () => new Date(t) });

    expect(s.stopped).toBe("tick_wall");
    expect(x.calls.some((c) => c.path.endsWith("/publish"))).toBe(false);
    expect(await rowOf(postId)).toMatchObject({ status: "drafted", article_id: "2117000000000000001" });
  });
});

// ---- X answered the publish, but is the post really there? ---------------------

describe("publish confirmation", () => {
  const CONFIRM = "/2/tweets/2118000000000000001";
  const gone = () => json(200, { errors: [{ title: "Not Found Error", detail: "Could not find tweet" }] });

  it("records published only after the lookup finds the post", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX();

    const s = await tick(x, "publish");

    expect(s.published).toBe(1);
    expect(x.count(CONFIRM)).toBe(1);
    expect(await rowOf(postId)).toMatchObject({ status: "published", x_post_id: "2118000000000000001" });
  });

  it("a post X cannot find: needs_attention publish_ambiguous, nothing recorded as published, never published again", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX({ lookup: gone });

    const s = await tick(x, "publish");
    await tick(x, "publish", {}, new Date(NOW.getTime() + 3 * HOUR));

    expect(s).toMatchObject({ published: 0, attention: 1 });
    expect(await rowOf(postId)).toMatchObject({
      status: "needs_attention",
      attention_reason: "publish_ambiguous",
      attention_detail: "publish answered ok; the post could not be read back, check x.com",
      x_post_id: null,
    });
    expect(x.count("/2/articles/2117000000000000001/publish")).toBe(1);
    expect(x.count(CONFIRM)).toBe(1);
  });

  it.each([
    ["a 500", () => json(500, { title: "Internal" })],
    ["a 503", () => json(503, { title: "Service Unavailable" })],
    ["a 401", () => json(401, { title: "Unauthorized" })],
    ["a 429", () => json(429, { title: "Too Many Requests" }, { "retry-after": "60" })],
    ["a 200 body it cannot read", () => json(200, {})],
    [
      "a network error",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ] as const)("a lookup that fails with %s is publish_ambiguous too, and the publish is not retried", async (_label, lookup) => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    const x = fakeX({ lookup });

    const s = await tick(x, "publish");
    await tick(x, "publish", {}, new Date(NOW.getTime() + 3 * HOUR));

    expect(s.published).toBe(0);
    const r = await rowOf(postId);
    expect(r).toMatchObject({ status: "needs_attention", attention_reason: "publish_ambiguous", x_post_id: null });
    expect(r.attention_detail).toMatch(/^publish answered ok; the post could not be read back .*check x\.com$/);
    expect(x.count("/2/articles/2117000000000000001/publish")).toBe(1);
    expect(x.count(CONFIRM)).toBe(1); // one read, never a waiting loop
  });

  it("with no time left for the lookup the publish is not recorded either", async () => {
    vi.stubEnv("RENDER", "true");
    const postId = await post();
    let t = NOW.getTime();
    const x = fakeX({
      publish: () => {
        t += 52_000; // a slow publish leaves 3 s of the 55 s tick
        return json(200, { data: { post_id: "2118000000000000001" } }, { "x-user-limit-24hour-remaining": "4" });
      },
    });

    await tick(x, "publish", { now: () => new Date(t) });

    expect(x.count(CONFIRM)).toBe(0);
    expect(await rowOf(postId)).toMatchObject({
      status: "needs_attention",
      attention_reason: "publish_ambiguous",
      attention_detail: "publish answered ok; there was no time to read the post back, check x.com",
      x_post_id: null,
    });
  });

  it("gives the lookup a timeout within the 15 s call budget", async () => {
    vi.stubEnv("RENDER", "true");
    await post();
    const seen: number[] = [];
    const realSignal = AbortSignal.timeout;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      seen.push(ms);
      return realSignal.call(AbortSignal, ms);
    });

    await tick(fakeX(), "publish");

    expect(seen).toHaveLength(5); // cover fetch, cover upload, draft, publish, lookup
    for (const ms of seen) expect(ms).toBeLessThanOrEqual(15_000);
  });
});

// ---- hostile input and what gets logged -------------------------------------------

describe("hostile post content", () => {
  it.each([
    ["a script tag", "Hello\n\n<script>alert(1)</script>\n"],
    ["inline HTML", "A <img src=x onerror=alert(1)> b"],
    ["a javascript: link", "[click](javascript:alert(1))"],
    ["a data: link", "[click](data:text/html;base64,PHNjcmlwdD4=)"],
    ["a vbscript: link", "[x](vbscript:msgbox(1))"],
  ])("refuses %s before any X call", async (_label, contentMd) => {
    const postId = await post({ contentMd });
    const x = fakeX();

    await tick(x);

    expect(await rowOf(postId)).toMatchObject({ status: "needs_attention", attention_reason: "converter_refused" });
    expect(x.calls).toEqual([]);
  });

  it("strips control characters from the text it sends", async () => {
    // Postgres text cannot hold NUL, so that byte never reaches the runner; the rest can.
    await post({ contentMd: "Clean\u000b text\u0007 here\u001b\u007f." });
    const x = fakeX();

    await tick(x);

    const sent = JSON.stringify(x.calls.find((c) => c.path === "/2/articles/draft")!.body);
    expect(sent).toContain("Clean text here.");
     
    expect(sent).not.toMatch(/\\u000b|\\u0007|\\u001b|\\u007f/);
  });

  it("handles a body well over the 200 KB API cap without throwing or hanging", async () => {
    const postId = await post({ contentMd: Array.from({ length: 6000 }, (_, i) => `Paragraph ${i} ${"word ".repeat(10)}`).join("\n\n") });
    const x = fakeX();

    const started = Date.now();
    await tick(x);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(["draft_only", "needs_attention"]).toContain((await rowOf(postId)).status);
  });
});

describe("logging", () => {
  it("never logs a key, a header, a response body, a title or post text", async () => {
    vi.stubEnv("RENDER", "true");
    const logged: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    await post({ slug: "s-1", title: "SECRETTITLE one", contentMd: "SECRETPOSTTEXT one" });
    await post({ slug: "s-2", title: "SECRETTITLE two", contentMd: "SECRETPOSTTEXT two" });
    await post({ slug: "s-3", title: "SECRETTITLE three", contentMd: "| a |\n|---|\n| SECRETPOSTTEXT |" });
    // One row gets a draft and then a lost publish answer, the other a refused draft, the third a refused body.
    let drafts = 0;
    const x = fakeX({
      draft: () =>
        ++drafts === 1
          ? json(201, { data: { id: "2117000000000000001" } }, { "x-user-limit-24hour-remaining": "8" })
          : json(400, { title: "SECRETBODY", detail: "SECRETBODY", authorization: "OAuth oauth_token=SECRETHEADER" }, { "x-secret-header": "SECRETHEADER" }),
      publish: () => json(500, { title: "SECRETBODY" }, { "x-secret-header": "SECRETHEADER" }),
    });

    await tick(x, "publish");

    expect(x.count("/2/articles/2117000000000000001/publish")).toBe(1);
    expect((await statuses()).sort()).toEqual(["needs_attention", "needs_attention", "needs_attention"]);
    const all = logged.join("\n");
    for (const secret of [...Object.values(KEYS), "SECRETTITLE", "SECRETPOSTTEXT", "SECRETBODY", "SECRETHEADER", "oauth_", "OAuth "]) {
      expect(all).not.toContain(secret);
    }
    const detail = (await h.client.query<{ attention_detail: string | null }>(`SELECT attention_detail FROM x_article_publication`)).rows
      .map((r) => r.attention_detail ?? "")
      .join("\n");
    // The column keeps X's own error text (status, title, code) but never a header, a key, or what we sent.
    expect(detail).not.toMatch(/SECRETHEADER|SECRETTITLE|SECRETPOSTTEXT|oauth_/);
    for (const key of Object.values(KEYS)) expect(detail).not.toContain(key);
  });
});
