// shortcut: HTML and plain text only, no PDF, no JavaScript rendering, no readability scoring; upgrade when a source we need is PDF-only or drawn client-side.
//
// Fetches one primary source for the news radar's drafting step and turns it
// into plain text, so a quote can be checked against what the page really says.
//
// The URL came out of a model's search answer, so it is untrusted input and this
// is an SSRF boundary. Nothing here trusts the URL, the redirect chain or the
// page:
//
//   - https only, port 443 only, no credentials, no single-label or
//     .local/.internal-style names, no IP literal that is not a public address
//   - the address a name resolves to is checked AT CONNECT TIME, inside the
//     socket's own lookup, so a name that answers "public" to a check and
//     "127.0.0.1" to the connection (DNS rebinding) is still refused
//   - redirects are followed by hand, at most 3, and every hop goes back through
//     the same URL checks before a connection is made
//   - 4 MB body cap enforced on the stream, one 20 s deadline for the whole call
//   - the page is text to read, never markup to render and never instructions:
//     this module only returns characters, and callers must fence them
//
// It never returns a half result. Any failure is a SourceFetchError whose message
// is safe to show; the raw error stays in `cause` for logs.

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { pipeline } from "node:stream";
import zlib from "node:zlib";

const USER_AGENT = "ArchosLabsNewsRadar/0.1 (+https://archoslabs.xyz)";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_URL_CHARS = 2048;
const TEXT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

/** Bad URL, blocked address, redirect problem, non-200, wrong type, too big, or timeout. */
export class SourceFetchError extends Error {
  override name = "SourceFetchError";
}

// --- addresses -------------------------------------------------------------

// Anything not listed here is public. IPv6 is the other way round: only global
// unicast (2000::/3) can be public, minus the documentation and tunnelling
// ranges inside it. That leaves ::ffff:0:0/96 (IPv4-mapped), 64:ff9b::/96
// (NAT64), fc00::/7, fe80::/10 and ff00::/8 refused without listing them.
const blocked = new net.BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast, and 240.0.0.0/4 reserved, in one block
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(base, prefix, "ipv4");
}
for (const [base, prefix] of [
  ["2001::", 23], // IETF protocol assignments, including Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 wraps an arbitrary IPv4 address
] as const) {
  blocked.addSubnet(base, prefix, "ipv6");
}
const globalUnicastV6 = new net.BlockList();
globalUnicastV6.addSubnet("2000::", 3, "ipv6");

/** True only for an address a public web server could have. Anything unparseable is false. */
export function isPublicAddress(ip: string): boolean {
  try {
    const family = net.isIP(ip);
    if (family === 4) return !blocked.check(ip, "ipv4");
    if (family === 6) return globalUnicastV6.check(ip, "ipv6") && !blocked.check(ip, "ipv6");
  } catch {
    // A zone id or other form BlockList rejects: treat as not public.
  }
  return false;
}

/**
 * Wraps a DNS lookup so a socket can only ever be opened to public addresses.
 * Passed to https.request as `lookup`, so it runs for every connection, hop and
 * retry. One non-public answer in a mixed set refuses the whole set, so an
 * attacker cannot win by listing a public address first.
 */
export function publicOnlyLookup(resolve: typeof dns.lookup = dns.lookup): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true as const }, (err, addresses) => {
      if (err) return callback(err, []);
      if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(new SourceFetchError("source host resolves to a non-public address"), []);
      }
      // Node asks for either shape, depending on its connection strategy.
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// --- URLs ------------------------------------------------------------------

const INTERNAL_NAME = /\.(localhost|local|internal|lan|home|corp|intranet)$/;

/**
 * The checks a URL must pass before any connection is made. `base` lets a
 * redirect Location be relative. The URL parser has already turned hex, decimal
 * and octal IP spellings into dotted form by the time the host is read here.
 */
export function assertFetchableUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new SourceFetchError("source URL is not a valid URL");
  }
  if (url.href.length > MAX_URL_CHARS) throw new SourceFetchError("source URL is too long");
  if (url.protocol !== "https:") throw new SourceFetchError("source URL must be https");
  if (url.username || url.password) throw new SourceFetchError("source URL must not carry credentials");
  if (url.port) throw new SourceFetchError("source URL must use the default https port");

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new SourceFetchError("source URL points at a non-public address");
  } else if (host === "localhost" || INTERNAL_NAME.test(host) || !host.includes(".")) {
    throw new SourceFetchError("source URL points at an internal host name");
  }
  return url;
}

// --- text ------------------------------------------------------------------

// Extracted text is never longer than the page it came from (tags only shrink,
// entities only shrink), so with the body cap enforced first this cap is never
// reached by fetchSource and a source can never be silently cut short.
const MAX_TEXT_CHARS = MAX_BODY_BYTES;
// Real pages put tens of KB of JSON in one attribute, so a tag may be long. The
// cap only stops a stray "<" from swallowing the rest of a page.
const MAX_TAG_CHARS = 256 * 1024;
// Page chrome and code. Dropped with everything inside them.
const SKIP = new Set(["nav", "footer", "aside", "script", "style", "noscript", "template", "svg", "iframe"]);
// Contents are not markup until the closing tag, so find that tag directly.
const RAW_TEXT = new Set(["script", "style"]);
const BLOCK = new Set([
  "p", "div", "br", "hr", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6",
  "tr", "td", "th", "table", "section", "article", "main", "header", "blockquote", "pre", "figure", "figcaption",
]);
const TAG_NAME = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)/;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…",
};

// Same length as the input, which toLowerCase() does not promise for every
// character, so an index found here is an index into the original.
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// One pass, and each replacement is never rescanned, so "&amp;lt;" ends as the
// literal "&lt;". Replacements are never longer than the reference they replace.
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

function tidy(s: string): string {
  return s
    .replace(/[^\P{Cc}\t\n\r]/gu, "")
    .replace(/[ \t\r\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Page text without the page. A single forward scan, so hostile markup cannot
 * make it quadratic: the next ">" is found once and reused, a "<" with no ">"
 * within 256 KB is just a character, and nothing recurses.
 *
 * Quoted ">" inside an attribute ends the tag early and leaks a few attribute
 * characters into the text; that only ever adds characters, never hides any.
 */
export function extractMainText(html: string): string {
  const lower = asciiLower(html);
  const n = html.length;
  let out = "";
  let i = 0;
  let gt = -1; // cached position of the first ">" after the last "<" looked at
  let skip: string | null = null;
  let depth = 0;

  while (i < n && out.length < MAX_TEXT_CHARS) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (!skip) out += html.slice(i);
      break;
    }
    if (!skip && lt > i) out += html.slice(i, lt);

    // Only a letter, "/" or "!" can start a tag. "a < b" is prose.
    const c = html.charCodeAt(lt + 1);
    const startsTag = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33;
    if (!startsTag) {
      if (!skip) out += "<";
      i = lt + 1;
      continue;
    }

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    if (gt < lt) gt = html.indexOf(">", lt + 1);
    if (gt === -1) break;
    if (gt - lt > MAX_TAG_CHARS) {
      if (!skip) out += "<";
      i = lt + 1;
      continue;
    }

    // Only the name is needed, so never slice a whole (possibly 256 KB) tag.
    const m = TAG_NAME.exec(html.slice(lt + 1, Math.min(gt, lt + 65)));
    i = gt + 1;
    if (!m) continue; // <!DOCTYPE>, </>, <?xml ?>
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = html.charCodeAt(gt - 1) === 47;

    if (skip) {
      if (name === skip) {
        if (closing) {
          if (--depth === 0) skip = null;
        } else if (!selfClosing) {
          depth++;
        }
      }
      continue;
    }
    if (!closing && RAW_TEXT.has(name) && !selfClosing) {
      const close = lower.indexOf("</" + name, i);
      if (close === -1) break; // never closed: everything after it is code
      const end = html.indexOf(">", close);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!closing && SKIP.has(name) && !selfClosing) {
      skip = name;
      depth = 1;
      continue;
    }
    if (BLOCK.has(name)) out += "\n";
  }
  return tidy(decodeEntities(out.slice(0, MAX_TEXT_CHARS)));
}

const matchForm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Does the source really say this? Typography (curly quotes, dashes, non-breaking
 * spaces, line wraps, capitalisation) is ignored; a changed word is not. A quote
 * under 20 characters proves nothing, so it never verifies.
 */
export function quoteIsInText(text: string, quote: string): boolean {
  const q = matchForm(quote);
  return q.length >= 20 && matchForm(text).includes(q);
}

// --- fetching --------------------------------------------------------------

/** One response, as much of it as the caller needs. Tests inject their own. */
export interface Hop {
  status: number;
  location: string | null;
  contentType: string | null;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export type Transport = (url: URL, init: { userAgent: string; signal: AbortSignal }) => Promise<Hop>;

const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h) ?? null;

const httpsTransport: Transport = (url, { userAgent, signal }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        signal,
        lookup: publicOnlyLookup(),
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "Accept-Encoding": "gzip, br",
        },
      },
      (res) => {
        const coding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
        const decoder =
          coding === "gzip" ? zlib.createGunzip()
          : coding === "br" ? zlib.createBrotliDecompress()
          : coding === "deflate" ? zlib.createInflate()
          : null;
        const body = decoder ? pipeline(res, decoder, () => {}) : res;
        resolve({
          status: res.statusCode ?? 0,
          location: first(res.headers.location),
          contentType: first(res.headers["content-type"]),
          body,
          close: () => {
            res.destroy();
            body.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

// Rejects when the shared deadline passes, whether or not the transport honours it.
function within<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readCapped(res: Hop, maxBytes: number): Promise<string> {
  let label = /charset=["']?([\w.:-]+)/i.exec(res.contentType ?? "")?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    decoder = new TextDecoder("utf-8");
    label = "utf-8";
  }
  let text = "";
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      res.close();
      throw new SourceFetchError(`source body is larger than the ${maxBytes} byte limit`);
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

export interface FetchedSource {
  /** Where the text came from, after any redirects. */
  url: string;
  /** Plain text. Untrusted: it is whatever the page said. */
  text: string;
}

export interface FetchSourceOptions {
  transport?: Transport;
  /** Some sources (SEC) refuse an undeclared client; they want a name and contact. */
  userAgent?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

export async function fetchSource(rawUrl: string, opts: FetchSourceOptions = {}): Promise<FetchedSource> {
  const transport = opts.transport ?? httpsTransport;
  const init = { userAgent: opts.userAgent ?? USER_AGENT };
  let url = assertFetchableUrl(rawUrl);

  const signal = AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  let open: Hop | null = null;
  try {
    let res = (open = await within(transport(url, { ...init, signal }), signal));
    for (let hops = 0; REDIRECT_STATUSES.has(res.status); hops++) {
      res.close();
      if (hops >= MAX_REDIRECTS) throw new SourceFetchError("source redirected too many times");
      if (!res.location) throw new SourceFetchError("source redirected without a destination");
      url = assertFetchableUrl(res.location, url);
      res = open = await within(transport(url, { ...init, signal }), signal);
    }
    if (res.status !== 200) {
      res.close();
      throw new SourceFetchError(`source returned HTTP ${res.status}`);
    }
    const type = (res.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!TEXT_TYPES.has(type)) {
      res.close();
      throw new SourceFetchError("source content type is not text or HTML");
    }
    // A caller may lower the limit, never raise it: see MAX_TEXT_CHARS.
    const maxBytes = Math.min(opts.maxBytes ?? MAX_BODY_BYTES, MAX_BODY_BYTES);
    const body = await within(readCapped(res, maxBytes), signal);
    return { url: url.href, text: type === "text/plain" ? tidy(body) : extractMainText(body) };
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    throw new SourceFetchError(signal.aborted ? "source request timed out" : "source request failed", {
      cause: err,
    });
  } finally {
    open?.close();
  }
}
