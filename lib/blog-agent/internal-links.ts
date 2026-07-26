// Wraps phrases already present in a finished draft with links to related
// posts. Pure — no DB, no network, no model call.
//
// Runs AFTER the gate, and that is safe for one specific reason: it only ever
// wraps words the gate already read and approved. It never adds a sentence, a
// claim or a figure. Anything that let a model rewrite the body after gating
// would put unreviewed text on the site, which is the hole the whole pipeline
// exists to close.
//
// The links are internal and built from our own database, so they are also not
// an injection surface the way an outbound link from research would be.

export interface LinkCandidate {
  slug: string;
  title: string;
}

export interface InsertedLink {
  slug: string;
  /** The text as it appears in the body, original casing preserved. */
  anchor: string;
}

/** Never the first or last word of an anchor — "the data" reads as a mistake. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "how", "if", "in", "into", "is", "it", "its", "not", "of",
  "on", "or", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "up", "was", "we", "what", "when", "where", "which", "who",
  "why", "will", "with", "without", "you", "your",
]);

/**
 * Regions a link must never be inserted into.
 *
 * Headings would break the table of contents (generateToc scans h2/h3).
 * Code would corrupt the sample. An existing link cannot be nested. And a
 * blockquote is usually a quotation — silently editing someone's words, even
 * to add a link, is not ours to do.
 */
const PROTECTED = [
  /```[\s\S]*?```/g, // fenced code
  /`[^`\n]+`/g, // inline code
  /^#{1,6}[^\n]*$/gm, // headings
  /!?\[[^\]]*\]\([^)]*\)/g, // existing links and images
  /^>[^\n]*$/gm, // blockquotes
  /https?:\/\/\S+/g, // bare URLs
];

function protectedMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const re of PROTECTED) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
    }
  }
  return mask;
}

/**
 * Phrases from a post title worth linking, longest first.
 *
 * Contiguous 4-, 3- and 2-word runs, with any run that starts or ends on a
 * stopword thrown away. Single words are excluded deliberately: a one-word
 * anchor is both ambiguous and the thing that makes a page look spun.
 */
export function anchorPhrases(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const phrases: string[] = [];
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const run = words.slice(i, i + n);
      if (STOPWORDS.has(run[0]) || STOPWORDS.has(run[run.length - 1])) continue;
      if (run.every((w) => STOPWORDS.has(w))) continue;
      phrases.push(run.join(" "));
    }
  }
  return phrases;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a title phrase against body prose, tolerating the two differences that
 * actually occur.
 *
 * Measured on a real run: 1 of 6 candidates matched, and the misses were all
 * highly relevant posts. The cause was not relevance, it was literalness —
 * titles say "AI Pilots" where the body says "AI pilot", and markdown wraps
 * lines so two words of a phrase can be split by a newline.
 *
 * So trailing "s" is optional, and any run of whitespace matches any other.
 *
 * The two halves of the plural rule are not symmetric, which is easy to get
 * wrong. *Adding* an optional "s" can only ever lengthen what matches, so it
 * needs no guard at all — a title saying "Data Gap" reaches a body saying
 * "data gaps", and "ai" gaining a harmless "ais?" costs nothing. *Stripping* a
 * trailing "s" shortens the match, and on a short word that is a real hazard:
 * "is" would become "i" and catch a stray letter. So only stripping is gated,
 * at four characters.
 */
function phraseRegExp(phrase: string): RegExp {
  const pattern = phrase
    .split(" ")
    .map((word) => {
      const escaped = escapeRegExp(word);
      if (escaped.endsWith("s")) {
        return word.length >= 4 ? `${escaped.slice(0, -1)}s?` : escaped;
      }
      return `${escaped}s?`;
    })
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "gi");
}

/** Which paragraph an offset falls in, so links do not clump together. */
function paragraphIndexer(text: string): (offset: number) => number {
  const bounds: number[] = [];
  for (const m of text.matchAll(/\n\s*\n/g)) {
    if (m.index !== undefined) bounds.push(m.index);
  }
  return (offset) => bounds.filter((b) => b < offset).length;
}

/**
 * Link up to `max` related posts from phrases already in the body.
 *
 * Candidates are tried in the order given (most similar first) and each is
 * used at most once. At most one link per paragraph, because two in the same
 * breath reads like SEO filler rather than a reference.
 *
 * Returns the original markdown unchanged when no phrase matches, which is a
 * normal outcome — the writer did not know these posts existed.
 */
export function insertInternalLinks(
  contentMd: string,
  candidates: LinkCandidate[],
  options: { max?: number } = {},
): { contentMd: string; inserted: InsertedLink[] } {
  const max = options.max ?? 3;
  if (max <= 0 || candidates.length === 0) {
    return { contentMd, inserted: [] };
  }

  const mask = protectedMask(contentMd);
  const paragraphOf = paragraphIndexer(contentMd);
  const usedParagraphs = new Set<number>();
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const inserted: InsertedLink[] = [];

  for (const candidate of candidates) {
    if (inserted.length >= max) break;

    let placed = false;
    for (const phrase of anchorPhrases(candidate.title)) {
      if (placed) break;
      const re = phraseRegExp(phrase);

      for (const m of contentMd.matchAll(re)) {
        if (m.index === undefined) continue;
        const start = m.index;
        const end = start + m[0].length;

        // Skip anything overlapping a protected region or an earlier edit.
        let blocked = false;
        for (let i = start; i < end; i++) {
          if (mask[i]) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const para = paragraphOf(start);
        if (usedParagraphs.has(para)) continue;

        edits.push({
          start,
          end,
          // Original casing kept: the anchor must read as part of the sentence.
          replacement: `[${m[0]}](/blog/${candidate.slug})`,
        });
        for (let i = start; i < end; i++) mask[i] = true;
        usedParagraphs.add(para);
        inserted.push({ slug: candidate.slug, anchor: m[0] });
        placed = true;
        break;
      }
    }
  }

  // Apply back to front so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = contentMd;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }

  return { contentMd: out, inserted };
}
