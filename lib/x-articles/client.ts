import { oauth1Header, type XCredentials } from "./oauth1";

// Thin X API v2 client for the Article flow. Never throws for HTTP or network
// problems: every outcome is an XResult. Failure detail carries the status and
// X's own error title/detail/code only, never headers, request or response bodies.
//
// The error mapping is the reviewed contract. publishDraft differs on purpose:
// once the publish request is sent, any 5xx, timeout, network error or answer
// we cannot read means the Article may already be live, so the caller must
// never retry it ("ambiguous"). A 429 means the publish was refused.

const BASE_URL = "https://api.x.com";

// The one response header we report. X limits drafts per user per day, a refused
// call uses a slot too, and this header is the only place the count is visible.
export type XMeta = { userLimit24hRemaining?: number };

export type XFailure = {
  ok: false;
  kind: "auth" | "rate_limited" | "rejected" | "transient" | "ambiguous";
  status?: number;
  retryAfterMs?: number;
  detail: string;
  meta?: XMeta;
};
export type XResult<T> = { ok: true; value: T; meta?: XMeta } | XFailure;
// A post X says does not exist. Not an XFailure: nothing is wrong with the call.
export type XNotFound = { ok: false; kind: "not_found"; detail: string; meta?: XMeta };
export interface XOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const ms = /^\d+$/.test(v) ? Number(v) * 1000 : Date.parse(v) - Date.now();
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

function parseMeta(value: string | null): XMeta | undefined {
  return value !== null && /^\d+$/.test(value) ? { userLimit24hRemaining: Number(value) } : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// An id is a non-empty string; a number counts only when it is exact.
function idOf(v: unknown): string | undefined {
  if (typeof v === "string" && v) return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return undefined;
}

function errorDetail(status: number, text: string): string {
  const body = parseJson(text);
  const top = isRecord(body) ? body : {};
  const first = Array.isArray(top.errors) && isRecord(top.errors[0]) ? top.errors[0] : {};
  const parts = [top.title, top.detail, top.code ?? first.code].filter(
    (p): p is string | number => typeof p === "string" || typeof p === "number",
  );
  return [`HTTP ${status}`, ...parts].join(" | ").slice(0, 200);
}

async function send(
  creds: XCredentials,
  req: { method: "GET" | "POST"; path: string; body?: unknown; isPublish?: boolean },
  opts: XOptions = {},
): Promise<XResult<unknown>> {
  const url = `${BASE_URL}${req.path}`;
  // Unknown outcome: harmless to retry, except for publish.
  const unsure = req.isPublish ? "ambiguous" : "transient";

  let status: number;
  let retryAfter: string | null;
  let meta: XMeta | undefined;
  let text: string;
  try {
    const resp = await (opts.fetchImpl ?? fetch)(url, {
      method: req.method,
      headers: {
        Authorization: oauth1Header({ method: req.method, url, credentials: creds }),
        ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    status = resp.status;
    retryAfter = resp.headers.get("retry-after");
    meta = parseMeta(resp.headers.get("x-user-limit-24hour-remaining"));
    text = await resp.text();
  } catch (err) {
    // The error name only: an error object can carry the request.
    return {
      ok: false,
      kind: unsure,
      detail: `request failed: ${err instanceof Error ? err.name : "unknown"}`,
    };
  }

  if (status >= 200 && status < 300) return { ok: true, value: parseJson(text), meta };

  const detail = errorDetail(status, text);
  if (status === 401 || status === 403) return { ok: false, kind: "auth", status, detail, meta };
  if (status === 429) {
    return { ok: false, kind: "rate_limited", status, retryAfterMs: parseRetryAfter(retryAfter), detail, meta };
  }
  if (status >= 400 && status < 500) return { ok: false, kind: "rejected", status, detail, meta };
  return { ok: false, kind: unsure, status, detail, meta };
}

// Run a request and pull one value out of a 2xx body; a body without it is malformed.
async function sendAndPick<T>(
  creds: XCredentials,
  req: Parameters<typeof send>[1],
  pick: (body: Record<string, unknown>) => T | undefined,
  opts?: XOptions,
): Promise<XResult<T>> {
  const res = await send(creds, req, opts);
  if (!res.ok) return res;
  const value = pick(isRecord(res.value) ? res.value : {});
  if (value !== undefined) return { ok: true, value, meta: res.meta };
  return {
    ok: false,
    kind: req.isPublish ? "ambiguous" : "rejected",
    detail: "malformed response",
    meta: res.meta,
  };
}

const dataOf = (body: Record<string, unknown>) => (isRecord(body.data) ? body.data : {});

export function getMe(creds: XCredentials, opts?: XOptions) {
  return sendAndPick(
    creds,
    { method: "GET", path: "/2/users/me" },
    (body) => {
      const id = idOf(dataOf(body).id);
      const username = dataOf(body).username;
      return id && typeof username === "string" && username ? { id, username } : undefined;
    },
    opts,
  );
}

export function uploadMedia(
  creds: XCredentials,
  media: { bytes: Uint8Array; mediaCategory: "tweet_image" },
  opts?: XOptions,
) {
  return sendAndPick(
    creds,
    {
      method: "POST",
      path: "/2/media/upload",
      body: { media: Buffer.from(media.bytes).toString("base64"), media_category: media.mediaCategory },
    },
    (body) => {
      // Response shape is unverified until the live spike: accept the v2 and v1.1 spellings.
      const data = dataOf(body);
      const mediaId = idOf(data.id) ?? idOf(data.media_id_string) ?? idOf(data.media_id);
      return mediaId ? { mediaId } : undefined;
    },
    opts,
  );
}

export function createDraft(
  creds: XCredentials,
  draft: { title: string; contentState: unknown; coverMediaId?: string },
  opts?: XOptions,
) {
  return sendAndPick(
    creds,
    {
      method: "POST",
      path: "/2/articles/draft",
      body: {
        title: draft.title,
        content_state: draft.contentState,
        ...(draft.coverMediaId
          ? { cover_media: { media_id: draft.coverMediaId, media_category: "tweet_image" } }
          : {}),
      },
    },
    (body) => {
      const articleId = idOf(dataOf(body).id);
      return articleId ? { articleId } : undefined;
    },
    opts,
  );
}

export async function publishDraft(
  creds: XCredentials,
  articleId: string,
  opts?: XOptions,
): Promise<XResult<{ postId: string }>> {
  // The id goes into the URL path: refuse anything that is not a plain number.
  if (!/^[0-9]{1,19}$/.test(articleId)) {
    return { ok: false, kind: "rejected", detail: "invalid article id" };
  }
  return sendAndPick(
    creds,
    { method: "POST", path: `/2/articles/${articleId}/publish`, isPublish: true },
    (body) => {
      const postId = idOf(dataOf(body).post_id);
      return postId ? { postId } : undefined;
    },
    opts,
  );
}

// X reports a missing post inside a 200 body ("Not Found Error"), not as a 404, and a
// publish has answered 200 with a post id that never existed. So the id from
// publishDraft is believed only once this finds the post.
export async function getPost(
  creds: XCredentials,
  postId: string,
  opts?: XOptions,
): Promise<XResult<{ postId: string }> | XNotFound> {
  // The id goes into the URL path: refuse anything that is not a plain number.
  if (!/^[0-9]{1,19}$/.test(postId)) return { ok: false, kind: "rejected", detail: "invalid post id" };
  const res = await send(creds, { method: "GET", path: `/2/tweets/${postId}` }, opts);
  if (!res.ok) return res;
  const body = isRecord(res.value) ? res.value : {};
  if (idOf(dataOf(body).id) === postId) return { ok: true, value: { postId }, meta: res.meta };
  const gone = Array.isArray(body.errors) && body.errors.some((e) => isRecord(e) && e.title === "Not Found Error");
  return gone
    ? { ok: false, kind: "not_found", detail: "post not found", meta: res.meta }
    : { ok: false, kind: "rejected", detail: "malformed response", meta: res.meta };
}
