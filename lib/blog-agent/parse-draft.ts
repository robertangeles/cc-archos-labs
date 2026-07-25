// Pure parser for the essay step's markdown output. No DB, no network,
// no server-only deps — the whole point is that this is testable against
// real historical drafts with zero cost.
//
// The shape it parses is not a spec we control; it is whatever the
// `archos-paul-graham-essays` skill happens to emit. So the contract below
// was derived empirically from all 7 completed runs in the DB
// (lib/blog-agent/__fixtures__/real-drafts.json), not from a prompt:
//
//   # Title                            <- line 0, present 7/7
//                                      <- blank
//   *Standfirst sentence.*             <- italic, present 7/7 -> excerpt
//   ...body...
//   ---                                <- optional rule, 3/7
//   **SEO Package**                    <- 3/7 ONLY. Never anchor on this.
//   **LSI keywords used:** a, b, c     <- 7/7
//   **URL slug:** some-slug            <- 7/7
//   **SEO title:** ...                 <- 7/7
//   **Meta description:** ...          <- 7/7
//   **Tags:** a, b, c                  <- 7/7
//
// The section header is unstable, the field labels are not. Anchoring on
// the header would have silently swallowed the SEO block into the body on
// 4 of 7 real drafts. Anchor on the earliest field marker instead.

export interface ParsedDraft {
  title: string;
  excerpt: string;
  /** Body markdown with the H1 and the whole SEO block removed. */
  contentMd: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
}

/**
 * Markers that can open the trailing SEO block. We cut at whichever appears
 * first, so a draft that omits the `**SEO Package**` header still splits at
 * `**LSI keywords used:**` (or, failing that, `**URL slug:**`).
 */
const SEO_BLOCK_OPENERS = [
  /\*\*SEO Package\*\*/,
  /\*\*LSI keywords[^*]*\*\*/,
  /\*\*URL slug[^*]*\*\*/,
];

/**
 * Pull `**Label:** value` out of the SEO block. Case-insensitive.
 *
 * Two things here are deliberate and both were caught by the fixture tests:
 *
 *  - The label is matched EXACTLY (`:?` and nothing else before the closing
 *    `**`). A looser `[^*]*` also matches `**Meta description alt 1:**`, which
 *    the skill emits two of — so deleting the real `**Meta description:**`
 *    line silently fell through to an alt instead of failing.
 *  - The value cannot cross a newline (`[^\n]+`, and horizontal whitespace
 *    only before it). A `\s*` there let an empty `**URL slug:**` swallow the
 *    following `**SEO title:** ...` line and return it as the slug.
 *
 * Both bugs produced a plausible-looking wrong answer rather than a failure,
 * which is the class of bug this whole module exists to avoid.
 */
function field(block: string, label: string): string | null {
  const re = new RegExp(`\\*\\*${label}:?\\*\\*[^\\S\\n]*([^\\n]+)`, "i");
  const m = block.match(re);
  if (!m) return null;
  const value = m[1].trim();
  return value.length > 0 ? value : null;
}

/**
 * Parse one `article_draft` into the fields `createPost` needs.
 *
 * Returns `null` when any required field is missing. That is deliberate and
 * load-bearing: the caller must fail the item to a draft rather than publish
 * a half-parsed post. A silent partial parse is exactly the failure mode the
 * whole pipeline exists to prevent, so there is no "best effort" path here.
 */
export function parseDraft(articleDraft: string): ParsedDraft | null {
  const text = articleDraft.trim();
  if (!text) return null;

  // --- Title: the leading H1 ------------------------------------------------
  // It must also be stripped from the body. The public post page renders the
  // title via PostHeader, and generateToc (lib/post-rendering.ts) only scans
  // h2/h3 — a leading H1 left in contentMd renders as a duplicate title.
  const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
  if (!titleMatch || titleMatch.index !== 0) return null;
  const title = titleMatch[1].trim();
  if (!title) return null;

  const afterTitle = text.slice(titleMatch[0].length).trim();

  // --- Split body from the SEO block ---------------------------------------
  const cut = SEO_BLOCK_OPENERS.reduce((min, re) => {
    const m = afterTitle.match(re);
    return m && m.index !== undefined && m.index < min ? m.index : min;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(cut)) return null;

  const seoBlock = afterTitle.slice(cut);
  // Drop the trailing horizontal rule that precedes the block on some drafts.
  const bodyRegion = afterTitle
    .slice(0, cut)
    .trimEnd()
    .replace(/\n+-{3,}\s*$/, "")
    .trimEnd();

  // --- Excerpt: the italic standfirst directly under the title -------------
  const standfirstMatch = bodyRegion.match(/^\*([^*][\s\S]*?)\*\s*$/m);
  const excerpt =
    standfirstMatch && standfirstMatch.index === 0
      ? standfirstMatch[1].trim().replace(/\s+/g, " ")
      : "";
  if (!excerpt) return null;

  const contentMd = bodyRegion.slice(standfirstMatch![0].length).trim();
  if (!contentMd) return null;

  // --- SEO fields -----------------------------------------------------------
  const slug = field(seoBlock, "URL slug");
  const seoTitle = field(seoBlock, "SEO title");
  const seoDescription = field(seoBlock, "Meta description");
  const rawTags = field(seoBlock, "Tags");
  if (!slug || !seoTitle || !seoDescription || !rawTags) return null;

  // post.tags caps at 8 (lib/posts-admin/schema.ts). The skill routinely emits
  // more, so trim here rather than letting PostCreateSchema reject the save.
  const tags = rawTags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tags.length === 0) return null;

  return {
    title,
    excerpt,
    contentMd,
    slug: normaliseSlug(slug),
    seoTitle,
    seoDescription,
    tags,
  };
}

/**
 * Coerce the emitted slug into the shape PostSlugSchema accepts
 * (lower kebab-case, 1-200 chars). The skill usually emits a clean slug, but
 * it is a free-text field in a markdown blob, so normalise rather than trust.
 */
export function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}
