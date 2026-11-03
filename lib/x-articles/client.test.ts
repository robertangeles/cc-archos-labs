import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraft, getMe, getPost, publishDraft, uploadMedia, type XResult } from "./client";
import type { XCredentials } from "./oauth1";

// The client never throws: every HTTP or network outcome is an XResult. The
// publish call differs on purpose: any answer we cannot trust is "ambiguous"
// because the Article may already be live. No real call is made here.

const CREDS: XCredentials = {
  apiKey: "FAKE_api_key_k1",
  apiSecret: "FAKE_api_secret_s2",
  accessToken: "123-FAKE_access_t3",
  accessTokenSecret: "FAKE_access_secret_s4",
};

type Fetch = ReturnType<typeof vi.fn> & typeof fetch;

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

// A fetch stand-in: a Response, or an Error to reject with.
function fakeFetch(outcome: Response | Error): Fetch {
  return vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as unknown as Fetch;
}

const abortError = () => Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

// Everything a failure may say, checked against the fake secrets and the header.
function expectNoLeak(result: XResult<unknown>, fetchImpl: Fetch) {
  const auth = (fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
    | Record<string, string>
    | undefined;
  const text = JSON.stringify(result);
  for (const secret of Object.values(CREDS)) expect(text).not.toContain(secret);
  expect(text).not.toContain("OAuth ");
  if (auth?.Authorization) expect(text).not.toContain(auth.Authorization);
}

const ECHO_BODY = {
  title: "Invalid Request",
  detail: "One parameter is invalid.",
  code: 99,
  echo: { authorization: "OAuth oauth_consumer_key=leak", secret: CREDS.apiSecret },
};

// The three calls that share the "draft-style" error contract.
const calls = {
  getMe: {
    run: (fetchImpl: Fetch) => getMe(CREDS, { fetchImpl }),
    okBody: { data: { id: "42", username: "robangeles" } },
    value: { id: "42", username: "robangeles" },
    noIdBody: { data: { username: "robangeles" } },
  },
  uploadMedia: {
    run: (fetchImpl: Fetch) =>
      uploadMedia(CREDS, { bytes: new Uint8Array([1, 2, 3]), mediaCategory: "tweet_image" }, { fetchImpl }),
    okBody: { data: { id: "777" } },
    value: { mediaId: "777" },
    noIdBody: { data: {} },
  },
  createDraft: {
    run: (fetchImpl: Fetch) =>
      createDraft(CREDS, { title: "T", contentState: { blocks: [] } }, { fetchImpl }),
    okBody: { data: { id: "9001" } },
    value: { articleId: "9001" },
    noIdBody: { data: { title: "T" } },
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each(Object.entries(calls))("%s error contract", (_name, c) => {
  it("returns the value on 200", async () => {
    expect(await c.run(fakeFetch(reply(200, c.okBody)))).toEqual({ ok: true, value: c.value });
  });

  it.each([401, 403])("maps %s to auth", async (status) => {
    const f = fakeFetch(reply(status, ECHO_BODY));
    const r = await c.run(f);
    expect(r).toMatchObject({ ok: false, kind: "auth", status });
    expectNoLeak(r, f);
  });

  it("maps 429 to rate_limited with Retry-After in seconds", async () => {
    const r = await c.run(fakeFetch(reply(429, {}, { "Retry-After": "120" })));
    expect(r).toMatchObject({ ok: false, kind: "rate_limited", status: 429, retryAfterMs: 120_000 });
  });

  it("maps 429 to rate_limited with Retry-After as an HTTP date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const r = await c.run(fakeFetch(reply(429, {}, { "Retry-After": "Tue, 03 Nov 2026 12:00:30 GMT" })));
    expect(r).toMatchObject({ kind: "rate_limited", retryAfterMs: 30_000 });
  });

  it("clamps an absurd Retry-After to one hour and ignores a missing or invalid one", async () => {
    const huge = await c.run(fakeFetch(reply(429, {}, { "Retry-After": "99999999" })));
    expect(huge).toMatchObject({ retryAfterMs: 3_600_000 });
    const none = await c.run(fakeFetch(reply(429)));
    expect(none).toMatchObject({ kind: "rate_limited", retryAfterMs: undefined });
    const junk = await c.run(fakeFetch(reply(429, {}, { "Retry-After": "soon" })));
    expect(junk).toMatchObject({ kind: "rate_limited", retryAfterMs: undefined });
  });

  it("maps other 4xx to rejected, with X's title, detail and code only", async () => {
    const f = fakeFetch(reply(400, ECHO_BODY));
    const r = await c.run(f);
    expect(r).toEqual({
      ok: false,
      kind: "rejected",
      status: 400,
      detail: "HTTP 400 | Invalid Request | One parameter is invalid. | 99",
    });
    expectNoLeak(r, f);
  });

  it("reads the code from an errors array and truncates long detail to 200 chars", async () => {
    const r = await c.run(fakeFetch(reply(400, { errors: [{ code: 187 }], title: "x".repeat(500) })));
    expect(r.ok === false && r.detail.length).toBe(200);
    const r2 = await c.run(fakeFetch(reply(400, { errors: [{ code: 187, message: "m" }] })));
    expect(r2).toMatchObject({ detail: "HTTP 400 | 187" });
  });

  it("maps 5xx to transient", async () => {
    expect(await c.run(fakeFetch(reply(500)))).toMatchObject({ ok: false, kind: "transient", status: 500 });
    expect(await c.run(fakeFetch(reply(503)))).toMatchObject({ kind: "transient", status: 503 });
  });

  it("maps a timeout and a network error to transient, naming the error type only", async () => {
    const f1 = fakeFetch(abortError());
    const timeout = await c.run(f1);
    expect(timeout).toEqual({ ok: false, kind: "transient", detail: "request failed: AbortError" });
    const f2 = fakeFetch(new TypeError(`fetch failed ${CREDS.apiSecret}`));
    const network = await c.run(f2);
    expect(network).toEqual({ ok: false, kind: "transient", detail: "request failed: TypeError" });
    expectNoLeak(network, f2);
  });

  it("maps a 2xx with malformed JSON or without the id to rejected", async () => {
    const expected = { ok: false, kind: "rejected", detail: "malformed response" };
    expect(await c.run(fakeFetch(reply(200, "not json {")))).toEqual(expected);
    expect(await c.run(fakeFetch(reply(200, c.noIdBody)))).toEqual(expected);
    expect(await c.run(fakeFetch(reply(200, [])))).toEqual(expected);
  });
});

// X's per-user daily draft limit is only visible in this header; a refused call uses a slot too.
describe.each(Object.entries(calls))("%s daily-limit header", (_name, c) => {
  const LIMIT = "x-user-limit-24hour-remaining";

  it("reports the remaining slots on success and on every failure status", async () => {
    expect(await c.run(fakeFetch(reply(200, c.okBody, { [LIMIT]: "7" })))).toEqual({
      ok: true,
      value: c.value,
      meta: { userLimit24hRemaining: 7 },
    });
    for (const status of [401, 429, 400, 503]) {
      const r = await c.run(fakeFetch(reply(status, {}, { [LIMIT]: "3" })));
      expect(r.ok === false && r.status).toBe(status);
      expect(r.meta).toEqual({ userLimit24hRemaining: 3 });
    }
    const malformed = await c.run(fakeFetch(reply(200, c.noIdBody, { [LIMIT]: "2" })));
    expect(malformed).toMatchObject({ ok: false, detail: "malformed response", meta: { userLimit24hRemaining: 2 } });
  });

  it("keeps zero, which is the case that matters most", async () => {
    const r = await c.run(fakeFetch(reply(200, c.okBody, { [LIMIT]: "0" })));
    expect(r.meta).toEqual({ userLimit24hRemaining: 0 });
  });

  it("leaves meta off when the header is absent or not a whole number", async () => {
    expect((await c.run(fakeFetch(reply(200, c.okBody)))).meta).toBeUndefined();
    expect((await c.run(fakeFetch(reply(503)))).meta).toBeUndefined();
    for (const junk of ["abc", "", "-1", "1.5", "0x10", "7 left", "1e3"]) {
      expect((await c.run(fakeFetch(reply(200, c.okBody, { [LIMIT]: junk })))).meta).toBeUndefined();
    }
  });

  it("has nothing to report after a network error", async () => {
    expect((await c.run(fakeFetch(abortError()))).meta).toBeUndefined();
  });

  it("exposes no other header", async () => {
    const r = await c.run(
      fakeFetch(
        reply(503, {}, { [LIMIT]: "4", "x-rate-limit-limit": "40000", "x-transaction-id": "txn-abc", "retry-after": "5" }),
      ),
    );
    expect(Object.keys(r.meta ?? {})).toEqual(["userLimit24hRemaining"]);
    expect(JSON.stringify(r)).not.toMatch(/40000|txn-abc/);
  });
});

describe("request shape", () => {
  function sent(f: Fetch) {
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(
      new RegExp(`^OAuth oauth_consumer_key="${CREDS.apiKey}", oauth_nonce="[0-9a-f]{32}", oauth_signature="[^"]+"`),
    );
    return { url, init, headers };
  }

  it("getMe: GET /2/users/me, signed, no body", async () => {
    const f = fakeFetch(reply(200, calls.getMe.okBody));
    await getMe(CREDS, { fetchImpl: f });
    const { url, init, headers } = sent(f);
    expect(url).toBe("https://api.x.com/2/users/me");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("uploadMedia: POST /2/media/upload with base64 media and category", async () => {
    const f = fakeFetch(reply(200, calls.uploadMedia.okBody));
    await uploadMedia(CREDS, { bytes: new Uint8Array([1, 2, 3]), mediaCategory: "tweet_image" }, { fetchImpl: f });
    const { url, init, headers } = sent(f);
    expect(url).toBe("https://api.x.com/2/media/upload");
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ media: "AQID", media_category: "tweet_image" });
  });

  it("uploadMedia: reads the id from the media_id_string and media_id spellings", async () => {
    const byString = await uploadMedia(
      CREDS,
      { bytes: new Uint8Array([1]), mediaCategory: "tweet_image" },
      { fetchImpl: fakeFetch(reply(200, { data: { media_id_string: "55" } })) },
    );
    expect(byString).toEqual({ ok: true, value: { mediaId: "55" } });
    const byNumber = await uploadMedia(
      CREDS,
      { bytes: new Uint8Array([1]), mediaCategory: "tweet_image" },
      { fetchImpl: fakeFetch(reply(200, { data: { media_id: 56 } })) },
    );
    expect(byNumber).toEqual({ ok: true, value: { mediaId: "56" } });
  });

  it("createDraft: POST /2/articles/draft with title, content_state and the cover when given", async () => {
    const f = fakeFetch(reply(200, calls.createDraft.okBody));
    await createDraft(CREDS, { title: "Hello", contentState: { blocks: [1] }, coverMediaId: "777" }, { fetchImpl: f });
    const { url, init } = sent(f);
    expect(url).toBe("https://api.x.com/2/articles/draft");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Hello",
      content_state: { blocks: [1] },
      cover_media: { media_id: "777", media_category: "tweet_image" },
    });
  });

  it("createDraft: omits cover_media without a cover", async () => {
    const f = fakeFetch(reply(200, calls.createDraft.okBody));
    await createDraft(CREDS, { title: "Hello", contentState: {} }, { fetchImpl: f });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      title: "Hello",
      content_state: {},
    });
  });

  it("publishDraft: POST /2/articles/{id}/publish with no body", async () => {
    const f = fakeFetch(reply(200, { data: { post_id: "5551" } }));
    const r = await publishDraft(CREDS, "9001", { fetchImpl: f });
    expect(r).toEqual({ ok: true, value: { postId: "5551" } });
    const { url, init } = sent(f);
    expect(url).toBe("https://api.x.com/2/articles/9001/publish");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("times out through the abort signal", async () => {
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    ) as unknown as Fetch;
    expect(await getMe(CREDS, { fetchImpl: f, timeoutMs: 20 })).toMatchObject({
      ok: false,
      kind: "transient",
      detail: "request failed: TimeoutError",
    });
    expect(await publishDraft(CREDS, "9001", { fetchImpl: f, timeoutMs: 20 })).toMatchObject({
      kind: "ambiguous",
    });
  });
});

describe("publishDraft error contract", () => {
  const run = (f: Fetch) => publishDraft(CREDS, "9001", { fetchImpl: f });

  it.each([401, 403])("maps %s to auth", async (status) => {
    const f = fakeFetch(reply(status, ECHO_BODY));
    const r = await run(f);
    expect(r).toMatchObject({ ok: false, kind: "auth", status });
    expectNoLeak(r, f);
  });

  it("maps 429 to rate_limited (the publish was refused, safe to retry later)", async () => {
    expect(await run(fakeFetch(reply(429, {}, { "Retry-After": "60" })))).toMatchObject({
      kind: "rate_limited",
      status: 429,
      retryAfterMs: 60_000,
    });
  });

  it("reports the remaining daily slots, including on an ambiguous failure", async () => {
    const limit = { "x-user-limit-24hour-remaining": "5" };
    expect(await run(fakeFetch(reply(200, { data: { post_id: "1" } }, limit)))).toEqual({
      ok: true,
      value: { postId: "1" },
      meta: { userLimit24hRemaining: 5 },
    });
    expect(await run(fakeFetch(reply(503, {}, limit)))).toMatchObject({
      kind: "ambiguous",
      meta: { userLimit24hRemaining: 5 },
    });
  });

  it("maps other 4xx to rejected", async () => {
    const f = fakeFetch(reply(422, ECHO_BODY));
    const r = await run(f);
    expect(r).toMatchObject({ ok: false, kind: "rejected", status: 422 });
    expectNoLeak(r, f);
  });

  it.each([500, 502, 503, 504])("maps %s to ambiguous: the Article may be live", async (status) => {
    expect(await run(fakeFetch(reply(status)))).toMatchObject({ ok: false, kind: "ambiguous", status });
  });

  it("maps a timeout and a network error to ambiguous", async () => {
    expect(await run(fakeFetch(abortError()))).toMatchObject({ ok: false, kind: "ambiguous" });
    const f = fakeFetch(new TypeError(`fetch failed ${CREDS.accessTokenSecret}`));
    const r = await run(f);
    expect(r).toEqual({ ok: false, kind: "ambiguous", detail: "request failed: TypeError" });
    expectNoLeak(r, f);
  });

  it("maps a 2xx without data.post_id, or with a malformed body, to ambiguous", async () => {
    const expected = { ok: false, kind: "ambiguous", detail: "malformed response" };
    expect(await run(fakeFetch(reply(200, { data: {} })))).toEqual(expected);
    expect(await run(fakeFetch(reply(200, "not json {")))).toEqual(expected);
    expect(await run(fakeFetch(reply(201, { data: { id: "1" } })))).toEqual(expected);
  });

  it.each(["", "abc", "12a", "../1", "1/publish", "1 ", "12345678901234567890"])(
    "rejects the article id %j without calling fetch",
    async (id) => {
      const f = fakeFetch(reply(200, { data: { post_id: "1" } }));
      expect(await publishDraft(CREDS, id, { fetchImpl: f })).toMatchObject({ ok: false, kind: "rejected" });
      expect(f).not.toHaveBeenCalled();
    },
  );
});

// X can answer a publish with 200 and a post id that never existed, and it reports a
// missing post inside a 200 body ("Not Found Error"), not as a 404. getPost is how the
// runner finds out; "not_found" is its own kind, never confused with a transient failure.
describe("getPost", () => {
  const ID = "2118000000000000001";
  const notFoundBody = {
    errors: [{ title: "Not Found Error", type: "https://api.twitter.com/2/problems/resource-not-found", detail: "gone" }],
  };

  it("found: a 200 body whose data.id is the post", async () => {
    const f = fakeFetch(reply(200, { data: { id: ID, text: "t" } }, { "x-user-limit-24hour-remaining": "4" }));
    expect(await getPost(CREDS, ID, { fetchImpl: f })).toEqual({
      ok: true,
      value: { postId: ID },
      meta: { userLimit24hRemaining: 4 },
    });
  });

  it("not_found: a 200 body with a Not Found Error and no data", async () => {
    const r = await getPost(CREDS, ID, { fetchImpl: fakeFetch(reply(200, notFoundBody)) });
    expect(r).toMatchObject({ ok: false, kind: "not_found" });
  });

  it.each([
    ["an empty 200 body", {}],
    ["errors about something else", { errors: [{ title: "Authorization Error" }] }],
    ["data about another post", { data: { id: "2118000000000000002" } }],
    ["data with no id", { data: { text: "t" } }],
  ])("a malformed answer is a rejection, not a find or a not_found: %s", async (_label, body) => {
    expect(await getPost(CREDS, ID, { fetchImpl: fakeFetch(reply(200, body)) })).toMatchObject({
      ok: false,
      kind: "rejected",
      detail: "malformed response",
    });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [400, "rejected"],
    [500, "transient"],
    [503, "transient"],
  ])("HTTP %i is %s, never not_found", async (status, kind) => {
    expect(await getPost(CREDS, ID, { fetchImpl: fakeFetch(reply(status, {})) })).toMatchObject({ ok: false, kind });
  });

  it("a timeout or network error is transient", async () => {
    expect(await getPost(CREDS, ID, { fetchImpl: fakeFetch(abortError()) })).toMatchObject({ ok: false, kind: "transient" });
    expect(await getPost(CREDS, ID, { fetchImpl: fakeFetch(new TypeError("fetch failed")) })).toMatchObject({
      ok: false,
      kind: "transient",
    });
  });

  it.each(["", "abc", "12/../34", "1".repeat(20), "12 34", "1.5"])("refuses the id %j without a call", async (id) => {
    const f = fakeFetch(reply(200, {}));
    expect(await getPost(CREDS, id, { fetchImpl: f })).toMatchObject({ ok: false, kind: "rejected", detail: "invalid post id" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends a signed GET to /2/tweets/{id} with no body", async () => {
    const f = fakeFetch(reply(200, { data: { id: ID } }));
    await getPost(CREDS, ID, { fetchImpl: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.x.com/2/tweets/${ID}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^OAuth /);
  });

  it("never carries a secret, a header or X's echoed body in a failure", async () => {
    const f = fakeFetch(reply(500, ECHO_BODY));
    const r = await getPost(CREDS, ID, { fetchImpl: f });
    expectNoLeak(r, f);
  });
});
