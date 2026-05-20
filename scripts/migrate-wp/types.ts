// Type definitions for the WP → Archos Labs migration pipeline.
//
// The pipeline transforms data progressively. Each stage takes the previous
// stage's output type and produces the next. This keeps the orchestrator
// (index.ts) simple: pipe a Post through each module and the type system
// guarantees we don't skip a step.
//
//   RawWpPost  →  ExtractedPost  →  TransformedPost  →  PolishedPost
//                                                            ↓
//                                                       EmbeddedPost
//                                                            ↓
//                                                       MediaRehostedPost
//                                                            ↓
//                                                       OgGeneratedPost
//                                                            ↓
//                                                          (insert)

// =============================================================================
// WP source row shapes (mysql2 results)
// =============================================================================

export interface WpPostRow {
  ID: number;
  post_author: number;
  post_date: Date | string;
  post_date_gmt: Date | string;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_status: string;
  post_name: string; // slug
  post_modified: Date | string;
  post_type: string;
}

export interface WpAuthorRow {
  ID: number;
  user_login: string;
  display_name: string;
}

export interface WpCategoryRow {
  term_id: number;
  name: string;
  slug: string;
}

export interface WpFeaturedImage {
  attachment_id: number;
  source_url: string; // absolute URL to the original-size image on the WP host
  alt_text: string | null;
}

// =============================================================================
// Pipeline stage shapes
// =============================================================================

/**
 * Result of extract.ts. One per published WP post (post_type='post',
 * post_status='publish'). All cross-table JOINs are resolved at extract
 * time so downstream stages have everything in-hand.
 */
export interface ExtractedPost {
  // Idempotency key for upserts. Matches WP `uhiz_posts.ID`.
  sourceWpId: number;
  // WP `post_name` — used as the new `post.slug` (1:1 mapping per
  // permalink_structure '/%postname%/').
  slug: string;
  title: string;
  // Raw HTML body from WP (Gutenberg HTML output, no shortcodes per
  // 2026-05-19 inventory).
  rawHtml: string;
  // WP `post_excerpt`. May be empty; Claude polish will generate one if so.
  rawExcerpt: string;
  // First-publish date — set in `post.published_at`.
  publishedAt: Date;
  // WP `post_modified` — used to set `post.last_reviewed_at` at migration.
  modifiedAt: Date;
  // Author resolved from uhiz_users. Single author today.
  author: {
    sourceUserId: number;
    userLogin: string;
    displayName: string;
  };
  // Primary category. Derived from uhiz_yoast_primary_term when set,
  // otherwise the first assigned category. Per 2026-05-19 inventory,
  // multi-category is negligible.
  category: {
    sourceTermId: number;
    name: string;
    slug: string;
  };
  // All tag slugs assigned to this post (raw — Phase A4 filter applies
  // count >= 2 downstream).
  tags: Array<{
    sourceTermId: number;
    name: string;
    slug: string;
  }>;
  // Featured image. NULL only if WP has no `_thumbnail_id` postmeta
  // (inventory showed 100% coverage so this should never be null in
  // practice — defensive typing).
  featuredImage: WpFeaturedImage | null;
  // Yoast focus keyphrase. Used as a tag-generation seed for Claude
  // polish. 61% of posts have one set per inventory.
  yoastFocusKeyphrase: string | null;
}

/**
 * Result of transform.ts. HTML → markdown via Turndown.
 */
export interface TransformedPost extends ExtractedPost {
  // Turndown output. May contain `<img src="https://robertangeles.com/...">`
  // image references that media-rehost.ts will rewrite.
  contentMd: string;
  // Computed from contentMd word count / 200 wpm.
  readingTimeMin: number;
  wordCount: number;
}

/**
 * Result of claude-polish.ts. Claude generates the editorial polish.
 */
export interface PolishedPost extends TransformedPost {
  // 1-2 sentence summary suitable for /blog index card + JSON-LD
  // og:description + newsletter card preview. Replaces WP excerpt if
  // Claude's is better; otherwise keeps the WP one.
  excerpt: string;
  // Topic tags derived by Claude from content + focus keyphrase seed.
  // Filtered against the "tags with count >= 2" allowlist downstream.
  claudeTags: string[];
  // TRUE when Claude's currency check flagged outdated content (refers
  // to pre-EU-AI-Act terminology, retired vendors, stale Anthropic
  // model IDs, etc.).
  currencyConcerns: string[];
  // TRUE if any heuristic suggests human review before publish:
  // - Claude returned malformed JSON despite retries
  // - currencyConcerns non-empty
  // - transform produced unusually short markdown (<300 chars)
  needsReview: boolean;
}

/**
 * Result of embed.ts. Voyage voyage-3-large 1024-dim vector.
 */
export interface EmbeddedPost extends PolishedPost {
  // 1024-element float32 array. Stored as pgvector column.
  embedding: number[];
}

/**
 * Result of media-rehost.ts. Image URLs in markdown rewritten to point
 * at R2 instead of robertangeles.com.
 */
export interface MediaRehostedPost extends EmbeddedPost {
  // contentMd with image URLs rewritten to R2-served paths. Original
  // EmbeddedPost.contentMd is preserved on the record (we re-embed only
  // if the title/excerpt change, not the media).
  contentMdRehosted: string;
  // Featured image rehosted to R2. Used as the base for OG image
  // generation + as the post's primary image in JSON-LD.
  featuredImageR2Url: string;
  // Count of inline images rehosted. Manifest stat.
  inlineImageCount: number;
}

/**
 * Result of og-generate.ts. Branded OG image rendered + uploaded.
 */
export interface OgGeneratedPost extends MediaRehostedPost {
  // R2 path for the generated OG image (templated typographic poster
  // per design DES-3).
  ogImagePath: string;
  ogImageGeneratedAt: Date;
}

// =============================================================================
// Manifest types
// =============================================================================

/**
 * Per-post entry in the migration manifest. Captures every transform
 * decision so the admin "needs review" queue + post-mortem diffs work.
 */
export interface PostManifestEntry {
  sourceWpId: number;
  slug: string;
  title: string;
  decisions: {
    categoryResolved: string;
    tagsKept: string[];
    tagsFiltered: string[];
    excerptSource: "wp" | "claude" | "generated";
    needsReview: boolean;
    currencyConcerns: string[];
    inlineImageCount: number;
    embeddingDim: number | null;
    ogGenerated: boolean;
  };
  errors: string[];
  status: "dry_run" | "extracted" | "transformed" | "polished" | "embedded" | "media_rehosted" | "og_generated" | "inserted" | "failed";
  durationMs: number;
}

export interface Manifest {
  generatedAt: string; // ISO datetime
  mode: "dry_run" | "apply";
  source: {
    databaseHost: string; // host only (no credentials)
    databaseName: string;
    tablePrefix: string;
  };
  filters: {
    limit: number | null;
    slug: string | null;
    skipMedia: boolean;
    skipOg: boolean;
    skipEmbed: boolean;
  };
  totals: {
    extracted: number;
    transformed: number;
    polished: number;
    embedded: number;
    mediaRehosted: number;
    ogGenerated: number;
    inserted: number;
    failed: number;
    needsReview: number;
  };
  posts: PostManifestEntry[];
}

// =============================================================================
// Orchestrator config
// =============================================================================

export interface MigrationConfig {
  mode: "dry_run" | "apply";
  // Filter to first N posts (post-order, by published_at DESC).
  limit: number | null;
  // Filter to a single post by slug.
  slug: string | null;
  // Skip stages by name. Useful for partial reruns.
  skipMedia: boolean;
  skipOg: boolean;
  skipEmbed: boolean;
  // Optional manifest output path. Defaults to
  // scripts/migrate-wp/manifest-{ISO}.json next to the script.
  manifestPath: string | null;
  // Prod target. When true, the script reads PROD_DATABASE_URL instead
  // of DATABASE_URL and refuses to run unless --confirm-prod is also
  // passed. Designed so accidentally invoking `pnpm migrate-wp:apply`
  // from a shell that has prod creds loaded can never fire against
  // prod — the explicit double-flag is the safety gate.
  prod: boolean;
  // Required when prod=true. Without it the script halts.
  confirmProd: boolean;
}
