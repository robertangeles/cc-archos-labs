// Reading the essay the writer produced, and the checks that do not trust it.
//
// A model will, sooner or later, invent a quote, round a number, add a link or
// forget the verdict. Each of those is a plain check on text, so each is code, not
// a request in a prompt. runGates never fails open: a missing field is a failure.
//
// What counts as evidence for a quote is the TEXT OF THE SOURCES (what was fetched)
// and the headline coverage. The research brief is a model's output and is not
// evidence for a quote. For a number it is allowed, because a count the brief derived
// from the sources (25 of 64) appears only there.

import { normalizeForMatch } from "../source";

export const VERDICT_WORDS = ["true", "half true", "unproven", "overblown", "false"] as const;
/** The template appends " — Archos Labs" to the SEO title; Google shows about 60 characters. */
export const SEO_TITLE_MAX = 46;
export const META_MIN = 150;
export const META_MAX = 160;

export interface ParsedEssay {
  title: string;
  /** The italic line under the title; used as the excerpt. */
  meta: string;
  /** From the hook to the end, without the SEO package. */
  body: string;
  verdict: { word: string | null; count: number };
  seo: { slug?: string; seoTitle?: string; metaDescription?: string; tags: string[] };
}

export interface GateFailure {
  gate: "structure" | "seo" | "verdict" | "inference" | "links" | "style" | "length" | "quote" | "number";
  detail: string;
}

export interface Evidence {
  /** Text of every page that was fetched. */
  sources: string[];
  /** The headline and summary the story came from. */
  coverage: string;
  /** The research brief: counts as evidence for a number only. */
  brief: string;
  /**
   * Normalised copies and the number haystack, built once by prepareEvidence. The gates
   * run several times per job against pages of up to 4 MB; normalising them for every
   * quote of every run is the one thing here that gets slow.
   */
  prepared?: { normalized: string[]; haystack: string };
}

/** The sources and the coverage in the form quotes are compared in. Build once, reuse. */
export function normalizeTexts(texts: string[]): string[] {
  return texts.map(normalizeForMatch);
}

export function prepareEvidence(
  sources: string[],
  coverage: string,
  brief: string,
  normalized: string[] = normalizeTexts([...sources, coverage]),
): Evidence {
  return { sources, coverage, brief, prepared: { normalized, haystack: [...sources, coverage, brief].join("\n") } };
}

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const stripCode = (s: string) => s.replace(/`[^`]*`/g, " ");
const trimPunct = (s: string) => s.trim().replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "");

function field(pkg: string, name: string): string | undefined {
  const m = new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, "i").exec(pkg);
  return m ? m[1].trim() : undefined;
}

export function parseEssay(raw: string): ParsedEssay | null {
  const text = raw.replace(/\r\n/g, "\n");
  const split = text.split(/\n-{3,}[ \t]*\n+[ \t]*(?=## SEO Package)/i);
  let main = split[0];
  let pkg = split.slice(1).join("\n");
  if (!pkg) {
    const i = text.search(/\n## SEO Package/i);
    if (i >= 0) {
      main = text.slice(0, i);
      pkg = text.slice(i);
    }
  }

  const title = /^# (.+)$/m.exec(main);
  if (!title) return null;
  const afterTitle = main.slice(title.index + title[0].length);
  const meta = /^\*(?!\*)(.+?)\*[ \t]*$/m.exec(afterTitle);
  if (!meta) return null;

  const body = afterTitle.slice(meta.index + meta[0].length).replace(/\n-{3,}[ \t]*$/, "").trim();
  const verdictLines = body.split("\n").filter((l) => /^Verdict:/i.test(l.trim()));
  const word = verdictLines.length
    ? (new RegExp(`^Verdict:\\s*(${VERDICT_WORDS.join("|")})\\b`, "i").exec(verdictLines[0].trim())?.[1].toLowerCase() ?? null)
    : null;

  const seo: ParsedEssay["seo"] = { tags: [] };
  const slug = field(pkg, "URL slug");
  const seoTitle = field(pkg, "SEO title");
  const metaDescription = field(pkg, "Meta description");
  const tags = field(pkg, "Tags");
  if (slug !== undefined) seo.slug = slug;
  if (seoTitle !== undefined) seo.seoTitle = seoTitle;
  if (metaDescription !== undefined) seo.metaDescription = metaDescription;
  if (tags !== undefined) seo.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);

  return { title: title[1].trim(), meta: meta[1].trim(), body, verdict: { word, count: verdictLines.length }, seo };
}

/** Direct quotations of 6 or more characters, straight or curly, outside code spans. */
export function extractQuotes(body: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(body).matchAll(/["“]([^"”\n]{6,}?)["”]/g)) {
    const q = trimPunct(m[1]);
    if (q.length >= 6) out.add(q);
  }
  return [...out];
}

/**
 * Quotes that no text contains, compared after typography, case and spacing are
 * smoothed away. Pass `normalized` (from normalizeTexts) to skip re-normalising pages.
 */
export function findUnverifiedQuotes(body: string, texts: string[], normalized: string[] = normalizeTexts(texts)): string[] {
  return extractQuotes(body).filter((q) => {
    const nq = normalizeForMatch(q);
    return !normalized.some((t) => t.includes(nq));
  });
}

/** Numbers (with their % if any) that the evidence does not hold. Single digits are ignored. */
export function findUngroundedNumbers(text: string, haystack: string): string[] {
  const hay = haystack.replace(/,/g, "");
  const missing = new Set<string>();
  for (const m of stripCode(text).matchAll(/\b\d[\d,]*(?:\.\d+)?%?/g)) {
    const token = m[0].replace(/,/g, "");
    // A lone digit proves nothing and is everywhere; "4%" is still a claim.
    if (/^\d$/.test(token)) continue;
    if (!hay.includes(token)) missing.add(m[0]);
  }
  return [...missing];
}

const snippet = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}...` : s);

export function runGates(essay: ParsedEssay, evidence: Evidence, opts: { targetWords: number }): GateFailure[] {
  const f: GateFailure[] = [];
  const body = essay.body;
  const noCode = stripCode(body);

  // --- structure and SEO fields
  if (essay.title.length > 120) f.push({ gate: "structure", detail: `title is ${essay.title.length} characters` });
  if (essay.meta.length > 300) f.push({ gate: "structure", detail: "the meta line under the title is over 300 characters" });
  const { seoTitle, metaDescription, slug, tags } = essay.seo;
  if (!seoTitle) f.push({ gate: "seo", detail: "SEO title is missing" });
  else if (seoTitle.length > SEO_TITLE_MAX) f.push({ gate: "seo", detail: `SEO title is ${seoTitle.length} characters, the limit is ${SEO_TITLE_MAX}` });
  if (!metaDescription) f.push({ gate: "seo", detail: "meta description is missing" });
  else if (metaDescription.length < META_MIN || metaDescription.length > META_MAX)
    f.push({ gate: "seo", detail: `meta description is ${metaDescription.length} characters, it must be ${META_MIN} to ${META_MAX}` });
  if (!slug) f.push({ gate: "seo", detail: "URL slug is missing" });
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) f.push({ gate: "seo", detail: `URL slug is not clean: ${snippet(slug)}` });
  if (tags.length < 5 || tags.length > 8) f.push({ gate: "seo", detail: `${tags.length} tags, it must be 5 to 8` });
  else if (tags.some((t) => t.length < 2 || t.length > 64)) f.push({ gate: "seo", detail: "a tag is shorter than 2 or longer than 64 characters" });

  // --- verdict
  if (essay.verdict.count !== 1) f.push({ gate: "verdict", detail: `${essay.verdict.count} Verdict lines, there must be exactly one` });
  else if (!essay.verdict.word) f.push({ gate: "verdict", detail: `the verdict must be one of: ${VERDICT_WORDS.join(", ")}` });

  // --- things only the pipeline may add, and the skill's own hard rules
  if (/\[Inference\]/i.test(body)) f.push({ gate: "inference", detail: "a [Inference] tag is left in the text" });
  if (/\]\(|https?:\/\//i.test(body)) f.push({ gate: "links", detail: "the essay contains a link or URL; the pipeline adds the links" });
  if (/^#{1,6}\s+(sources|references|citations)\b/im.test(body)) f.push({ gate: "links", detail: "the essay has its own Sources section; the pipeline adds it" });
  if ((noCode.match(/—/g) ?? []).length > 1) f.push({ gate: "style", detail: "more than one em dash" });
  if (noCode.includes(";")) f.push({ gate: "style", detail: "a semicolon (the skill bans them)" });

  // --- length
  const words = wordCount(body);
  const lo = Math.floor(opts.targetWords * 0.6);
  const hi = Math.ceil(opts.targetWords * 1.2);
  if (words < lo || words > hi) f.push({ gate: "length", detail: `${words} words, the target is ${opts.targetWords} (allowed ${lo} to ${hi})` });

  // --- quotes and numbers: the checks that make "not made up" true
  const shown = `${essay.title}\n${essay.meta}\n${body}`;
  const texts = [...evidence.sources, evidence.coverage];
  for (const q of findUnverifiedQuotes(shown, texts, evidence.prepared?.normalized)) {
    f.push({ gate: "quote", detail: `not in any source: "${snippet(q)}"` });
  }
  const hay = evidence.prepared?.haystack ?? [...texts, evidence.brief].join("\n");
  for (const n of findUngroundedNumbers(shown, hay)) {
    f.push({ gate: "number", detail: `not in any source or the brief: ${n}` });
  }
  return f;
}
