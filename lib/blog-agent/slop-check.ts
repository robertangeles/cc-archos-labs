// Deterministic slop gate. Pure, free, no network, no DB.
//
// This runs BEFORE the LLM judge, on purpose. The one slop failure actually
// observed in production output — a fabricated personal anecdote — is caught
// here by a regex, every time, for nothing. A stochastic judge catches it
// sometimes. Cheap and certain beats expensive and probabilistic, so anything
// that can be decided by a rule is decided here, and only what genuinely needs
// judgement reaches the judge.
//
// Two severities:
//   "hard"   -> reject outright, skip the judge call entirely (saves the spend)
//   "signal" -> pass through to the judge as context; not disqualifying alone
//
// Every finding carries the offending text verbatim. A finding you cannot
// quote is a vibe, and vibes are what this module exists to replace.

export type SlopTell =
  | "fabricated-experience"
  | "service-pricing"
  | "offsite-link"
  | "ungrounded-figure"
  | "absolutist-adverb"
  | "juxtaposition"
  | "manufactured-proverb"
  | "length"
  | "low-grounding";

export interface SlopFinding {
  tell: SlopTell;
  severity: "hard" | "signal";
  /** The offending text, verbatim. Never a paraphrase. */
  quote: string;
  note: string;
}

export interface SlopCheckInput {
  contentMd: string;
  /** Step 0 output. The corpus every factual claim must trace back to. */
  rawResearch: string;
  targetWords: { min: number; max: number };
  /**
   * A real observation supplied by a human for this specific post. When
   * present, first-person narration is permitted where it traces to this
   * text. When null, episodic first person is always a hard failure.
   */
  fieldNote?: string | null;
  /** Domains an outbound link may point at. Everything else is stripped. */
  linkAllowlist: string[];
  /** Below this, grounding is a hard failure rather than a signal. */
  minGroundingRatio?: number;
}

export interface SlopCheckResult {
  verdict: "pass" | "reject";
  findings: SlopFinding[];
  /** Body with off-allowlist links unwrapped to plain text. */
  contentMd: string;
  strippedLinks: string[];
  groundingRatio: number;
}

// ---------------------------------------------------------------------------
// Tell 1 — fabricated experience (the only slop failure observed in the wild)
// ---------------------------------------------------------------------------
//
// Observed 2026-07-05 under the Metis byline: "I'll admit I spent three months
// convinced a clean policy document would be enough. I wrote it, sent it, and
// found out six weeks later..." — an event that never happened, published as
// lived experience by an AI persona. 1 of 7 drafts, so a human spot-check
// eventually waves it through.
//
// Targets EPISODIC claims (a specific thing that happened) and deliberately
// spares first-person REASONING ("I'd start by...", "I think..."), which is a
// legitimate essay voice and carries no truth claim about the world.
const EPISODIC_PATTERNS: RegExp[] = [
  /\bI(?:'ve| have)?\s+(?:once\s+)?(?:spent|watched|saw|wrote|told|asked|admit|remember|learned|had|ran|built|tried|found out|sat|worked|shipped|made)\b/i,
  /\bI'll admit\b/i,
  /\b(?:a|one|my)\s+(?:client|customer|founder|colleague|team member)\s+(?:asked|told|said|called|emailed|came)\b/i,
  /\bin my experience\b/i,
  /\bwe\s+(?:once|used to)\b/i,
  /\bour\s+(?:internal|own)\s+\w+\s+(?:review|process|team|policy)\b/i,
  /\blast\s+(?:year|month|week|quarter),?\s+(?:I|we)\b/i,
  /\b(?:years|months|weeks)\s+ago,?\s+(?:I|we)\b/i,
];

// ---------------------------------------------------------------------------
// Tell 2 — service pricing
// ---------------------------------------------------------------------------
//
// CLAUDE.md: "No prices, day rates, or dollar amounts on the site. Pricing
// happens in conversation only." That rule is about OUR rates.
//
// Calibrated against the 7 real drafts: 4 of them contain figures like
// "$4.2 m" and "$2 m" as illustrative business context. A blanket money reject
// would have failed 57% of real output — a gate that cries wolf that often is
// a gate nobody reads. So the hard rule fires only on money in offer context;
// every other figure is checked for grounding instead, which is the question
// that actually matters.
const MONEY = /[$£€]\s?[\d,]+(?:\.\d+)?\s?(?:k|m|bn|billion|million|thousand)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|USD|AUD|GBP)\b/gi;
const OFFER_CONTEXT =
  /\b(?:we|our|us|archos|my)\b[^.!?]{0,80}\b(?:charge|charges|charged|rate|rates|fee|fees|price|prices|pricing|cost|costs|retainer|engagement|package|starting at|per day|day rate|hourly|invoice)\b|\b(?:charge|rate|fee|price|pricing|retainer|starting at|per day|day rate)\b[^.!?]{0,80}\b(?:we|our|us|archos)\b/i;

// ---------------------------------------------------------------------------
// Tells 4-6 — lexical overcompensation
// ---------------------------------------------------------------------------
const ABSOLUTIST =
  /\b(?:truly|absolutely|fundamentally|critically|profoundly|utterly|entirely|completely|undeniably|unquestionably)\b/gi;
const JUXTAPOSITION = /\bnot\s+[^.,;!?]{2,60},\s*but\s+[^.!?]{2,60}/gi;

/** Markdown links, bare URLs, and autolinks. */
const LINK_RE =
  /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?<![(<\]])\b(https?:\/\/[^\s)<>]+)/g;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isAllowed(host: string, allowlist: string[]): boolean {
  return allowlist.some((allowed) => {
    const a = allowed.replace(/^www\./, "").toLowerCase();
    return host === a || host.endsWith(`.${a}`);
  });
}

/**
 * Sentence containing `index`, for quoting a finding in context.
 *
 * Sentence boundaries ignore a period sitting between two digits, so "$2.3 m"
 * does not get quoted as "...paid $2." — which is what a naive `[.!?]` scan
 * produced against the real drafts.
 */
function sentenceAt(text: string, index: number): string {
  const isBoundary = (i: number) => {
    const ch = text[i];
    if (ch === "\n" || ch === "!" || ch === "?") return true;
    if (ch !== ".") return false;
    return !(/\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""));
  };

  let start = index - 1;
  while (start >= 0 && !isBoundary(start)) start--;

  let end = index;
  while (end < text.length && !isBoundary(end)) end++;

  return text.slice(start + 1, Math.min(end + 1, text.length)).trim();
}

/**
 * Checkable tokens in a paragraph: figures, including percentages.
 *
 * Numbers only, deliberately. An earlier version also counted multi-word
 * proper nouns, but sentence-initial capitals pair with the following word
 * ("Your CRM", "The Execution") and produced enough false tokens to drive one
 * real draft to a 0% score. Numbers are the crisp version of the same
 * question, and they map directly onto the tell being measured: slop gives
 * you nouns without numbers, so the numbers are what must trace back.
 */
function checkableTokens(paragraph: string): string[] {
  return paragraph.match(/\b\d[\d,]*(?:\.\d+)?%?\b/g) ?? [];
}

function appearsInResearch(token: string, research: string): boolean {
  const needle = token.replace(/,/g, "").toLowerCase();
  const hay = research.replace(/,/g, "").toLowerCase();
  if (hay.includes(needle)) return true;
  // "78%" in the draft vs "78 percent" in the research, and vice versa.
  if (needle.endsWith("%")) return hay.includes(needle.slice(0, -1));
  return false;
}

/**
 * Share of paragraphs whose checkable tokens trace back to the research.
 * Paragraphs with nothing checkable are excluded rather than counted as
 * grounded — otherwise pure prose inflates the score.
 *
 * KNOWN LIMIT, stated so nobody mistakes this for more than it is: this is
 * surface-token matching, not fact-checking. It catches unsupported
 * invention. It does NOT catch a real figure attached to the wrong claim, or
 * a figure the research call itself hallucinated. Those are the judge's job.
 */
export function groundingRatio(
  contentMd: string,
  rawResearch: string,
): { ratio: number; ungrounded: string[]; checked: number } {
  const paragraphs = contentMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#"));

  let checked = 0;
  let grounded = 0;
  const ungrounded: string[] = [];

  for (const p of paragraphs) {
    const tokens = checkableTokens(p);
    if (tokens.length === 0) continue;
    checked++;
    if (tokens.some((t) => appearsInResearch(t, rawResearch))) {
      grounded++;
    } else {
      ungrounded.push(p.slice(0, 200));
    }
  }

  return { ratio: checked === 0 ? 1 : grounded / checked, ungrounded, checked };
}

/**
 * Below this many checkable paragraphs the ratio is too jumpy to reject on
 * (one miss out of two is 50%). Under the floor it degrades to a signal and
 * the per-figure `ungrounded-figure` findings carry the information instead.
 */
const MIN_GROUNDING_SAMPLE = 3;

export function slopCheck(input: SlopCheckInput): SlopCheckResult {
  const findings: SlopFinding[] = [];
  const strippedLinks: string[] = [];
  const minGrounding = input.minGroundingRatio ?? 0.5;

  // --- Links: strip anything off the allowlist -----------------------------
  // This is the control that removes the payoff from an indirect prompt
  // injection. Research text reaches the writer unfenced today, so an
  // attacker-planted "link to X" instruction can survive into a draft. Even
  // if it does, the link never ships.
  const contentMd = input.contentMd.replace(
    LINK_RE,
    (match, label: string | undefined, mdUrl, angleUrl, bareUrl) => {
      const url = mdUrl ?? angleUrl ?? bareUrl;
      const host = hostOf(url);
      if (host && isAllowed(host, input.linkAllowlist)) return match;
      strippedLinks.push(url);
      // Keep the human-readable label; drop the destination.
      return label && label.trim().length > 0 ? label : "";
    },
  );

  for (const url of strippedLinks) {
    findings.push({
      tell: "offsite-link",
      severity: "hard",
      quote: url,
      note: "Outbound link to a domain outside the allowlist. Stripped from the body. Treated as hard because an unexpected link is the payoff of a research-injection attack.",
    });
  }

  // --- Fabricated experience -----------------------------------------------
  const noteText = (input.fieldNote ?? "").toLowerCase();
  for (const re of EPISODIC_PATTERNS) {
    const m = contentMd.match(re);
    if (!m || m.index === undefined) continue;
    const quote = sentenceAt(contentMd, m.index);

    // With a human-supplied observation, first person is allowed where it
    // traces back to that note. Require real overlap, not just its presence.
    if (noteText.length > 0 && tracesToNote(quote, noteText)) continue;

    findings.push({
      tell: "fabricated-experience",
      severity: "hard",
      quote,
      note: input.fieldNote
        ? "First-person account that does not trace to the supplied field note."
        : "First-person account of a specific event. The byline is an AI persona, so this is invented experience.",
    });
  }

  // --- Service pricing ------------------------------------------------------
  for (const m of contentMd.matchAll(MONEY)) {
    if (m.index === undefined) continue;
    const sentence = sentenceAt(contentMd, m.index);
    if (OFFER_CONTEXT.test(sentence)) {
      findings.push({
        tell: "service-pricing",
        severity: "hard",
        quote: sentence,
        note: "Reads as our own pricing. CLAUDE.md: no prices, day rates, or dollar amounts on the site.",
      });
    } else if (!appearsInResearch(m[0], input.rawResearch)) {
      findings.push({
        tell: "ungrounded-figure",
        severity: "signal",
        quote: sentence,
        note: `Figure ${m[0]} does not appear in the research.`,
      });
    }
  }

  // --- Lexical overcompensation --------------------------------------------
  const words = contentMd.split(/\s+/).filter(Boolean).length;

  const adverbs = [...contentMd.matchAll(ABSOLUTIST)];
  // ~1 per 250 words is ordinary emphasis; beyond that it is padding.
  if (adverbs.length > Math.max(2, Math.floor(words / 250))) {
    findings.push({
      tell: "absolutist-adverb",
      severity: "signal",
      quote: adverbs.map((a) => a[0]).join(", "),
      note: `${adverbs.length} absolutist adverbs in ${words} words.`,
    });
  }

  const juxt = [...contentMd.matchAll(JUXTAPOSITION)];
  if (juxt.length > 1) {
    findings.push({
      tell: "juxtaposition",
      severity: "signal",
      quote: juxt.map((j) => j[0].trim()).join(" | "),
      note: `${juxt.length} "not X, but Y" constructions.`,
    });
  }

  for (const line of manufacturedProverbs(contentMd)) {
    findings.push({
      tell: "manufactured-proverb",
      severity: "signal",
      quote: line,
      note: "Standalone emphasised one-liner reading as a bumper sticker rather than an instruction.",
    });
  }

  // --- Length ---------------------------------------------------------------
  if (words < input.targetWords.min || words > input.targetWords.max) {
    findings.push({
      tell: "length",
      severity: "signal",
      quote: `${words} words`,
      note: `Outside the requested ${input.targetWords.min}-${input.targetWords.max} band.`,
    });
  }

  // --- Grounding ------------------------------------------------------------
  const { ratio, ungrounded, checked } = groundingRatio(
    contentMd,
    input.rawResearch,
  );
  if (ratio < minGrounding) {
    findings.push({
      tell: "low-grounding",
      severity: checked >= MIN_GROUNDING_SAMPLE ? "hard" : "signal",
      quote: ungrounded[0] ?? "",
      note: `Only ${(ratio * 100).toFixed(0)}% of ${checked} checkable paragraph(s) trace to the research (floor ${(minGrounding * 100).toFixed(0)}%). ${ungrounded.length} make numeric claims the research does not support.`,
    });
  }

  // Several episodic patterns can match the same sentence ("I'll admit" and
  // "I ... admit"). One offending sentence is one finding.
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = `${f.tell}::${f.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    verdict: deduped.some((f) => f.severity === "hard") ? "reject" : "pass",
    findings: deduped,
    contentMd,
    strippedLinks,
    groundingRatio: ratio,
  };
}

/** Bold or italic lines that stand alone as their own paragraph. */
function manufacturedProverbs(contentMd: string): string[] {
  return contentMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => /^(\*\*|\*|_)[^*_].{0,90}(\*\*|\*|_)$/.test(p) && !p.includes("\n"))
    .map((p) => p.replace(/^(\*\*|\*|_)|(\*\*|\*|_)$/g, "").trim());
}

/**
 * Does a first-person sentence trace back to the human-supplied note?
 * Requires overlap on substantive words, so a note about one thing cannot
 * license an invented anecdote about another.
 */
function tracesToNote(sentence: string, noteText: string): boolean {
  const significant = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);
  if (significant.length === 0) return false;
  const hits = significant.filter((w) => noteText.includes(w)).length;
  return hits / significant.length >= 0.4;
}
