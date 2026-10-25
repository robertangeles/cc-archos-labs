// shortcut: Atom from one known source only; upgrade to a library when a second feed format is added.
//
// Reads the HuggingNews Atom feed for the news radar. Everything in the feed
// is untrusted text from a host we do not control, so this is deliberately a
// strict extractor and not an XML parser:
//
//   - https only, host pinned to FEED_URL's host, redirects never leave it
//   - 1 MB body cap enforced on the stream, 20 s timeout
//   - any DOCTYPE or ENTITY declaration is refused outright, so there is no
//     entity expansion to attack. Only the five predefined entities and
//     numeric references are decoded, and numeric references only ever shrink
//     (5+ characters become 1), so decoding cannot amplify.
//   - every field comes out as plain text with a length cap. Markup in a
//     headline stays literal characters; nothing here ever emits HTML.
//
// An entry with no usable title, https link or date is skipped and counted in
// `skipped`. It never throws, so one bad story cannot hide the other 33.

export const FEED_URL = "https://huggingnews.com/feed.xml";

const FEED_HOST = new URL(FEED_URL).host;
const USER_AGENT = "ArchosLabsNewsRadar/0.1 (+https://archoslabs.xyz)";
const MAX_BODY_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Kept characters per field, after decoding. Well above the longest values in
// the live feed (title 90, summary 1,956 on 2026-10-25). URL_MAX stays under
// Postgres' btree row limit (~2.7 KB) so a stored source_url can always be indexed.
const TITLE_MAX = 500;
const SUMMARY_MAX = 4000;
const CATEGORY_MAX = 100;
const URL_MAX = 2048;
// The real feed carries about 40. A cap keeps one bad feed from becoming one
// giant INSERT; the rest are counted as skipped.
const MAX_ENTRIES = 200;

export interface FeedEntry {
  sourceUrl: string;
  title: string;
  summary: string;
  category: string | null;
  publishedAt: Date;
}

/** `skipped` counts entries dropped for a missing link, title or usable date. */
export interface ParsedFeed {
  entries: FeedEntry[];
  skipped: number;
}

/** Network failure, non-200, redirect off the host, body over 1 MB, or timeout. */
export class FeedFetchError extends Error {
  override name = "FeedFetchError";
}

/** Not a well-formed Atom feed: truncated, no <feed> root, or a DOCTYPE/ENTITY. */
export class FeedParseError extends Error {
  override name = "FeedParseError";
}

// --- parsing ---------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

// Decimal, hex, or one of the five names. Anything else (&nbsp;, &foo;) is not
// matched and stays in the text as written.
function decode(s: string): string {
  return s.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g,
    (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return NAMED_ENTITIES[name];
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex!, 16);
      const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      return valid ? String.fromCodePoint(cp) : "";
    },
  );
}

// Control characters (whitespace ones are handled by the caller) plus the bidi
// overrides and isolates, which can reorder a headline on screen.
const UNSAFE_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

// Entity-decode, then reduce to plain text and cap the length. A title or
// category is one line; a summary keeps single and double newlines.
function clean(raw: string, max: number, multiline = false): string {
  let s = decode(raw)
    .normalize("NFC")
    .replace(UNSAFE_CHARS, (c) => (/\s/.test(c) ? c : ""));
  s = multiline
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    : s.replace(/\s+/g, " ");
  // The slice must not leave half of a surrogate pair behind.
  return s.trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, "").trim();
}

// Everything below scans with indexOf, never a lazy regex over the whole text: a
// lazy match rescans to the end for every unclosed opener, so n openers in a 1 MB
// body cost n x 1 MB. Each scan here moves forward, so the total work is linear.

// Index of the next `<tag` that really is that tag (followed by whitespace, `/` or
// `>`, so `<titlex>` does not count), or -1.
function findOpen(s: string, tag: string, from: number): number {
  const open = `<${tag}`;
  for (let i = s.indexOf(open, from); i !== -1; i = s.indexOf(open, i + 1)) {
    if (/[\s/>]/.test(s.charAt(i + open.length))) return i;
  }
  return -1;
}

// The text of the first <tag>...</tag> in `block`, undecoded. A self-closing tag
// or one that never closes has no text. If the first one never closes, no later
// one can either (its closer would be the same), so one scan is enough.
function textOf(block: string, tag: string): string | null {
  const i = findOpen(block, tag, 0);
  if (i === -1) return null;
  const gt = block.indexOf(">", i);
  if (gt === -1 || block.charAt(gt - 1) === "/") return null;
  const close = block.indexOf(`</${tag}>`, gt + 1);
  return close === -1 ? null : block.slice(gt + 1, close);
}

// Every `<tag ...>` start tag in `block`, in order.
function* startTags(block: string, tag: string): Generator<string> {
  for (let i = findOpen(block, tag, 0); i !== -1; ) {
    const gt = block.indexOf(">", i);
    if (gt === -1) return;
    yield block.slice(i, gt + 1);
    i = findOpen(block, tag, gt + 1);
  }
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decode(m[1] ?? m[2]) : null;
}

// An absolute https URL with no embedded credentials, optionally on one exact
// host. `base` lets a redirect Location be relative. Returns null if not.
function httpsUrl(raw: string | null, host?: string, base?: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  const ok =
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (host === undefined || u.host === host) &&
    u.href.length <= URL_MAX;
  return ok ? u.href : null;
}

// RFC 3339 date-time. Date() silently rolls 2026-02-30 over to March 2, so the
// calendar day is checked separately.
const RFC3339 =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function parseDate(raw: string | null): Date | null {
  const m = RFC3339.exec(decode(raw ?? "").trim());
  if (!m) return null;
  const day = Number(m[3]);
  if (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day)).getUTCDate() !== day) return null;
  const d = new Date(m[0]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEntry(block: string): FeedEntry | null {
  const title = clean(textOf(block, "title") ?? "", TITLE_MAX);

  // The alternate link (a link with no rel means alternate in Atom). Only if
  // that is not a usable https URL, the entry <id>, and only on the feed host.
  let href: string | null = null;
  for (const tag of startTags(block, "link")) {
    const rel = attr(tag, "rel");
    if (rel === null || rel === "alternate") {
      href = attr(tag, "href");
      break;
    }
  }
  const sourceUrl =
    httpsUrl(href) ?? httpsUrl(decode(textOf(block, "id") ?? ""), FEED_HOST);

  const publishedAt =
    parseDate(textOf(block, "published")) ?? parseDate(textOf(block, "updated"));
  if (!title || !sourceUrl || !publishedAt) return null;

  const categoryTag = startTags(block, "category").next().value;
  const category = categoryTag
    ? clean(attr(categoryTag, "term") ?? "", CATEGORY_MAX) || null
    : null;
  const summary = clean(
    textOf(block, "summary") ?? textOf(block, "content") ?? "",
    SUMMARY_MAX,
    true,
  );
  return { sourceUrl, title, summary, category, publishedAt };
}

// One pass over comments and CDATA so neither can hide or fake an element:
// comments vanish, CDATA becomes the same text with <, > and & escaped, which
// the entity decoder turns back into literal characters (never decoded twice).
// An unterminated one is malformed. The next opener of each kind is remembered
// and only searched for again once the scan has moved past it, so this is linear.
function flatten(xml: string): string {
  let out = "";
  let pos = 0;
  let nextComment = xml.indexOf("<!--");
  let nextCdata = xml.indexOf("<![CDATA[");
  while (nextComment !== -1 || nextCdata !== -1) {
    const isComment = nextCdata === -1 || (nextComment !== -1 && nextComment < nextCdata);
    const start = isComment ? nextComment : nextCdata;
    const openLen = isComment ? 4 : 9;
    const end = xml.indexOf(isComment ? "-->" : "]]>", start + openLen);
    if (end === -1) {
      throw new FeedParseError("feed has an unterminated comment or CDATA section");
    }
    out += xml.slice(pos, start);
    if (!isComment) {
      out += xml
        .slice(start + openLen, end)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    pos = end + 3;
    if (nextComment !== -1 && nextComment < pos) nextComment = xml.indexOf("<!--", pos);
    if (nextCdata !== -1 && nextCdata < pos) nextCdata = xml.indexOf("<![CDATA[", pos);
  }
  return out + xml.slice(pos);
}

export function parseAtom(xml: string): ParsedFeed {
  // Before anything else, and on the raw text: a DTD is never legitimate here.
  if (/<!(?:DOCTYPE|ENTITY)/i.test(xml)) {
    throw new FeedParseError("feed contains a DOCTYPE or ENTITY declaration");
  }

  const doc = flatten(xml);
  if (!/^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?<feed[\s>]/.test(doc) || !doc.trimEnd().endsWith("</feed>")) {
    throw new FeedParseError("not a complete Atom feed");
  }

  const entries: FeedEntry[] = [];
  let skipped = 0;
  for (let i = findOpen(doc, "entry", 0); i !== -1; ) {
    const gt = doc.indexOf(">", i);
    if (gt === -1) throw new FeedParseError("not a complete Atom feed");
    let next = gt + 1;
    let entry: FeedEntry | null = null;
    if (doc.charAt(gt - 1) !== "/") {
      const close = doc.indexOf("</entry>", gt + 1);
      if (close === -1) throw new FeedParseError("feed has an entry that never closes");
      if (entries.length < MAX_ENTRIES) entry = parseEntry(doc.slice(gt + 1, close));
      next = close + "</entry>".length;
    }
    if (entry) entries.push(entry);
    else skipped++;
    i = findOpen(doc, "entry", next);
  }
  return { entries, skipped };
}

// --- fetching --------------------------------------------------------------

// Reads at most MAX_BODY_BYTES. The cap is enforced on the stream itself, so a
// missing or dishonest Content-Length cannot get a big body through.
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new FeedFetchError("feed body is larger than 1 MB");
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function fetchFeed(
  opts: { url?: string; fetchImpl?: typeof fetch } = {},
): Promise<ParsedFeed> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const first = httpsUrl(opts.url ?? FEED_URL, FEED_HOST);
  if (!first) throw new FeedFetchError(`feed url must be https on ${FEED_HOST}`);
  let url = first;

  // One deadline for the whole call: connect, redirects and reading the body.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const init: RequestInit = {
    redirect: "manual",
    signal,
    headers: { "User-Agent": USER_AGENT },
  };

  try {
    let res = await fetchImpl(url, init);
    for (let hops = 0; REDIRECT_STATUSES.has(res.status); hops++) {
      await res.body?.cancel();
      const next =
        hops < MAX_REDIRECTS ? httpsUrl(res.headers.get("location"), FEED_HOST, url) : null;
      if (!next) throw new FeedFetchError("feed redirected somewhere we will not follow");
      url = next;
      res = await fetchImpl(url, init);
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new FeedFetchError(`feed returned HTTP ${res.status}`);
    }
    return parseAtom(await readCapped(res));
  } catch (err) {
    if (err instanceof FeedFetchError || err instanceof FeedParseError) throw err;
    // The raw error stays in `cause` for logs; the message is safe to show.
    throw new FeedFetchError(
      signal.aborted ? "feed request timed out after 20 s" : "feed request failed",
      { cause: err },
    );
  }
}
