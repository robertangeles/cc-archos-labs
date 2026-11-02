// The research stage: can this story be written at all, and what do the sources
// really say?
//
//   discover   a search model proposes primary sources. Its URLs are leads, never
//              evidence: in testing it invented an exact quote and a URL that 404'd.
//   fetch      every lead is opened by fetchSource (SSRF-guarded, text only), up to
//              three at a time. A block notice served with a 200, or a page too thin to
//              be a document, is a failure, not a source.
//   assess     stop unless at least one fetched page is a PRIMARY document. A news site
//              never counts as primary, whatever the model labelled it.
//   brief      a writer model turns the fetched text into a research brief. Every direct
//              quote in it must exist in the fetched text or the headline coverage; one
//              corrected attempt, then stop.
//
// "Stop" is a result, not an exception: the job goes to needs_attention with the reason.
// "I could not reach the source" must never become "the source does not say it".

import type { fetchSource as FetchSource } from "../source";
import type { DraftConfig } from "./config";
import { findUnverifiedQuotes, normalizeTexts } from "./essay";
import { LlmError, type Llm } from "./llm";
import { buildPrompt, type SkillPrompt } from "./skills";
import { stepFromChat, stop, type Stop, type StepLog } from "./types";

export const BRIEF_SKILL = "archos-news-research-brief";

export interface StoryItem {
  title: string;
  summary: string;
  publishedAt: Date;
  sourceUrl: string;
}

export interface DiscoveredSource {
  url: string;
  kind: "primary" | "secondary";
  what: string;
}

export interface FetchedPage extends DiscoveredSource {
  finalUrl: string;
  title: string;
  text: string;
}

export interface SourceFailure {
  url: string;
  reason: "blocked" | "http" | "type" | "size" | "timeout" | "unsafe" | "thin" | "error";
  detail: string;
}

export interface ResearchDeps {
  llm: Llm;
  fetchSource: typeof FetchSource;
  skill: (slug: string) => Promise<SkillPrompt>;
}

export interface ResearchOk {
  ok: true;
  pages: FetchedPage[];
  failures: SourceFailure[];
  candidates: DiscoveredSource[];
  brief: string;
  /** The pages and the coverage, normalised once for every later quote check. */
  normalized: string[];
  steps: StepLog[];
}
export type ResearchResult = ResearchOk | (Stop & { steps: StepLog[] });

// --- discovery ---------------------------------------------------------------

const MAX_CANDIDATES = 10;

// Never a source: the story's own page, and places where anyone can post anything.
const NEVER_HOSTS = ["huggingnews.com", "x.com", "twitter.com", "facebook.com", "linkedin.com", "reddit.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be", "t.co", "bsky.app", "threads.net"];
// Commentary, however the model labels it.
const NEWS_HOSTS = [
  "reuters.com", "bloomberg.com", "wsj.com", "nytimes.com", "ft.com", "cnbc.com", "forbes.com", "techcrunch.com", "theverge.com",
  "wired.com", "arstechnica.com", "theinformation.com", "bbc.com", "bbc.co.uk", "cnn.com", "axios.com", "businessinsider.com",
  "venturebeat.com", "zdnet.com", "engadget.com", "theguardian.com", "medium.com", "substack.com", "yahoo.com", "msn.com",
];
const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i;

const onHost = (hostname: string, list: string[]) => list.some((h) => hostname === h || hostname.endsWith(`.${h}`));

function normaliseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u;
}

function parseJsonObject(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "");
  const a = stripped.indexOf("{");
  const b = stripped.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(stripped.slice(a, b + 1));
  } catch {
    return null;
  }
}

const SEARCH_SYSTEM =
  "You find primary sources for claims in AI news headlines. A PRIMARY source is the original document: a company filing, a regulator or government publication, a court document, a peer-reviewed paper or preprint, a dataset and its documentation, or an official post by the party being reported on. A news article, aggregator, newsletter or social post is SECONDARY. " +
  "Use only URLs you actually found while searching. Never construct, guess or invent a URL. Reply with only JSON.";

export async function discoverSources(llm: Llm, cfg: DraftConfig, item: StoryItem): Promise<DiscoveredSource[]> {
  const res = await llm({
    label: "discover",
    model: cfg.models.search,
    system: SEARCH_SYSTEM,
    user:
      `Headline: ${item.title}\nSummary: ${item.summary}\nPublished: ${item.publishedAt.toISOString().slice(0, 10)}\n\n` +
      `Find up to 6 primary documents behind the claims in this headline, and up to 2 reputable secondary sources that give the other side. Do not return the HuggingNews page.\n\n` +
      `Reply with JSON only, exactly this shape:\n{"sources":[{"url":"https://...","kind":"primary or secondary","what":"one short line on what this page is"}]}`,
    maxTokens: 3000,
    timeoutMs: 120_000,
  });

  const seen = new Set<string>();
  const primary: DiscoveredSource[] = [];
  const secondary: DiscoveredSource[] = [];
  const add = (rawUrl: unknown, kind: unknown, what: unknown) => {
    const u = normaliseUrl(rawUrl);
    if (!u || onHost(u.hostname, NEVER_HOSTS)) return;
    const key = u.href;
    if (seen.has(key)) return;
    seen.add(key);
    const isPrimary = kind === "primary" && !onHost(u.hostname, NEWS_HOSTS);
    (isPrimary ? primary : secondary).push({ url: key, kind: isPrimary ? "primary" : "secondary", what: typeof what === "string" ? what.slice(0, 160) : "" });
  };

  const parsed = parseJsonObject(res.text) as { sources?: unknown } | null;
  if (parsed && Array.isArray(parsed.sources)) {
    for (const s of parsed.sources) {
      if (s && typeof s === "object") add((s as { url?: unknown }).url, (s as { kind?: unknown }).kind, (s as { what?: unknown }).what);
    }
  }
  for (const c of res.citations) add(c.url, "secondary", c.title ?? "");
  return [...primary, ...secondary].slice(0, MAX_CANDIDATES);
}

// --- fetching ----------------------------------------------------------------

const POOL = 3;
const MIN_TEXT = 1200;
// A block notice is a few hundred characters of text; a real page that merely
// mentions captchas is longer. Applying the notice rule to bigger pages would
// reject documents.
const BLOCK_NOTICE_MAX = 1500;
const BLOCK_NOTICE = /undeclared automated tool|access denied|are you (a )?robot|verify you are (a )?human|enable javascript|just a moment|captcha|request blocked|unusual traffic/i;

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function failureOf(url: string, err: unknown): SourceFailure {
  const msg = err instanceof Error ? err.message : String(err);
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) return { url, reason: ["401", "403", "429"].includes(http[1]) ? "blocked" : "http", detail: `HTTP ${http[1]}` };
  if (/content type/i.test(msg)) return { url, reason: "type", detail: "not text or HTML" };
  if (/larger than/i.test(msg)) return { url, reason: "size", detail: "too large" };
  if (/timed out/i.test(msg)) return { url, reason: "timeout", detail: "timed out" };
  if (/non-public|internal host|must be https|credentials|default https port|valid URL|too long/i.test(msg)) return { url, reason: "unsafe", detail: "refused by the URL guard" };
  return { url, reason: "error", detail: "could not be fetched" };
}

const titleOf = (text: string) => (text.split("\n").find((l) => l.trim().length > 0) ?? "").trim().slice(0, 140);

export async function gatherSources(
  fetchSource: typeof FetchSource,
  candidates: DiscoveredSource[],
  opts: { max: number; contactEmail: string },
): Promise<{ pages: FetchedPage[]; failures: SourceFailure[] }> {
  const results = await mapPool(candidates, POOL, async (c): Promise<FetchedPage | SourceFailure> => {
    try {
      // The SEC wants a declared name and contact; nobody else is told who is asking.
      const sec = new URL(c.url).hostname.endsWith("sec.gov");
      const got = await fetchSource(c.url, sec ? { userAgent: `Archos Labs ${opts.contactEmail}` } : {});
      if (got.text.length < BLOCK_NOTICE_MAX && BLOCK_NOTICE.test(got.text)) return { url: c.url, reason: "blocked", detail: "a block notice, not the page" };
      if (got.text.length < MIN_TEXT) return { url: c.url, reason: "thin", detail: `only ${got.text.length} characters of text` };
      return { ...c, finalUrl: got.url, title: titleOf(got.text), text: got.text };
    } catch (err) {
      return failureOf(c.url, err);
    }
  });
  const pages = results.filter((r): r is FetchedPage => "text" in r).slice(0, opts.max);
  const failures = results.filter((r): r is SourceFailure => "reason" in r);
  return { pages, failures };
}

export function assessSources(
  candidates: DiscoveredSource[],
  pages: FetchedPage[],
  failures: SourceFailure[],
): { ok: true } | Stop {
  if (candidates.length === 0) return stop("no_sources_found", "the search proposed no usable source");
  if (pages.length === 0) {
    const counts = new Map<string, number>();
    for (const f of failures) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
    const why = [...counts].map(([r, n]) => `${r} x${n}`).join(", ");
    return stop("sources_unreachable", `${candidates.length} sources found, none could be read (${why})`);
  }
  if (!pages.some((p) => p.kind === "primary")) return stop("no_primary_source", `${pages.length} pages read, none is a primary document`);
  return { ok: true };
}

// --- what the writer sees ----------------------------------------------------

const STOPWORDS = new Set("that this with from have been were will into over than then them they what when which while about after before their there these those would could should also more most some such only other your just like".split(" "));

function queryTerms(item: StoryItem): string[] {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const words = text.match(/[a-z0-9][a-z0-9.%$'-]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))].slice(0, 40);
}

const WINDOW = 3000;

/**
 * A page too big for a prompt is cut down to the start plus the paragraphs that
 * mention the headline's own words and numbers, in their original order. Taking the
 * first N characters of a 3 MB filing would hand the writer only its cover page.
 */
export function selectExcerpt(text: string, terms: string[], max: number): string {
  if (text.length <= max) return text;
  const lower = terms.map((t) => t.toLowerCase());
  const paras = text.split(/\n{2,}/);
  const chosen = new Map<number, string>();
  let used = 0;
  const take = (i: number, p: string) => {
    let body = p;
    if (p.length > WINDOW) {
      const lp = p.toLowerCase();
      const hit = lower.map((t) => lp.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
      body = p.slice(Math.max(0, hit - WINDOW / 2), Math.max(0, hit - WINDOW / 2) + WINDOW);
    }
    chosen.set(i, body);
    used += body.length + 2;
  };
  for (let i = 0; i < paras.length && used < 1500; i++) take(i, paras[i]);

  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < paras.length; i++) {
    // No length floor: "Number of rows: 1." can be the line that matters. Matching the
    // headline's own words and numbers is the filter.
    if (chosen.has(i) || paras[i].trim().length === 0) continue;
    const lp = paras[i].toLowerCase();
    let score = 0;
    for (const t of lower) if (lp.includes(t)) score++;
    if (score > 0) scored.push({ i, score: score + (/\d/.test(paras[i]) ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { i } of scored) {
    const len = Math.min(paras[i].length, WINDOW) + 2;
    if (used + len > max) continue;
    take(i, paras[i]);
  }

  const order = [...chosen.keys()].sort((a, b) => a - b);
  let out = "";
  let prev = -2;
  for (const i of order) {
    out += (i === prev + 1 || out === "" ? (out === "" ? "" : "\n\n") : "\n\n[...]\n\n") + chosen.get(i);
    prev = i;
  }
  return out;
}

const DOCS_BUDGET = 110_000;

function documentsFor(pages: FetchedPage[], terms: string[]): string {
  const per = Math.floor(DOCS_BUDGET / Math.max(1, pages.length));
  return pages
    .map((p, i) => `<document id="${i + 1}" url="${p.finalUrl}" kind="${p.kind}">\n${selectExcerpt(p.text, terms, per)}\n</document>`)
    .join("\n\n");
}

// --- the stage ---------------------------------------------------------------

const AUDIENCE = "Readers who follow AI news and want each headline checked against its primary source";

export async function runResearch(deps: ResearchDeps, cfg: DraftConfig, item: StoryItem): Promise<ResearchResult> {
  const steps: StepLog[] = [];
  const stopWith = (s: Stop): ResearchResult => ({ ...s, steps });

  let candidates: DiscoveredSource[];
  try {
    const t0 = Date.now();
    candidates = await discoverSources(deps.llm, cfg, item);
    // The step's own cost comes from the model call; record what was proposed.
    steps.push({ stepKey: "discover", status: "ok", output: JSON.stringify(candidates), model: cfg.models.search, inputTokens: null, outputTokens: null, costUsd: null, durationMs: Date.now() - t0 });
  } catch (err) {
    if (err instanceof LlmError) return stopWith(stop("model_error", err.message));
    throw err;
  }

  const t1 = Date.now();
  const { pages, failures } = await gatherSources(deps.fetchSource, candidates, { max: cfg.maxSources, contactEmail: cfg.contactEmail });
  steps.push({
    stepKey: "sources",
    status: pages.length > 0 ? "ok" : "failed",
    output: JSON.stringify({ read: pages.map((p) => ({ url: p.finalUrl, kind: p.kind, chars: p.text.length, title: p.title })), failed: failures }),
    model: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    durationMs: Date.now() - t1,
  });

  const verdict = assessSources(candidates, pages, failures);
  if (!verdict.ok) return stopWith(verdict);

  const skill = await deps.skill(BRIEF_SKILL);
  const coverage = `${item.title}\n${item.summary}`;
  const terms = queryTerms(item);
  const docs = documentsFor(pages, terms);
  const inputs = {
    plain: { target_audience: AUDIENCE, industry: "AI news", published: item.publishedAt.toISOString().slice(0, 10) },
    untrusted: { topic: `Behind the AI Headline: ${item.title}`, headline: item.title, coverage: item.summary, documents: docs },
  };
  const evidence = [...pages.map((p) => p.text), coverage];
  const normalized = normalizeTexts(evidence);

  const attempt = async (label: "brief" | "brief_retry", problems: string[]): Promise<{ text: string } | Stop> => {
    const prompt = buildPrompt(skill, {
      ...inputs,
      ...(problems.length
        ? { appendix: { heading: "PROBLEMS WITH YOUR PREVIOUS BRIEF. Rewrite the whole brief and fix every one. Quote only exact words from the documents, or paraphrase without quotation marks:", text: problems.map((q) => `- "${q}" is not in any document`).join("\n") } }
        : {}),
    });
    try {
      const res = await deps.llm({ label, model: cfg.models.writer, system: prompt.system, user: prompt.user, maxTokens: 12_000 });
      steps.push(stepFromChat(label, res));
      return { text: res.text };
    } catch (err) {
      if (err instanceof LlmError) return stop("model_error", err.message);
      throw err;
    }
  };

  let draft = await attempt("brief", []);
  if ("ok" in draft) return stopWith(draft);
  let bad = findUnverifiedQuotes(draft.text, evidence, normalized);
  if (bad.length > 0) {
    draft = await attempt("brief_retry", bad.slice(0, 8));
    if ("ok" in draft) return stopWith(draft);
    bad = findUnverifiedQuotes(draft.text, evidence, normalized);
    if (bad.length > 0) return stopWith(stop("unverified_quotes", `quotes not in any source: ${bad.slice(0, 3).map((q) => `"${q.slice(0, 80)}"`).join("; ")}`));
  }
  return { ok: true, pages, failures, candidates, brief: draft.text, normalized, steps };
}
