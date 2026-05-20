import "server-only";
import type { PostSitemapEntry } from "./posts";
import type { SiteSettings } from "./site-config-shared";

// Generators for /llms.txt (top-20 listed posts, AI-crawler index) and
// /llms-full.txt (every listed post with body). Format follows the
// emerging llms.txt convention — H1 site name + tagline, then a section
// per top-level resource group, then bullet entries.
//
// llms.txt is the "table of contents" — short. llms-full.txt is the
// full corpus dump — long. AI crawlers (GPTBot, ClaudeBot, PerplexityBot)
// preferentially read the .txt versions over crawling individual pages
// because it's cheaper for them and signals editorial intent.

export interface LlmsTxtArgs {
  settings: SiteSettings;
  siteUrl: string;
  posts: PostSitemapEntry[];
  /** Max posts to surface in llms.txt. Defaults to 20. */
  topN?: number;
}

export function buildLlmsTxt({
  settings,
  siteUrl,
  posts,
  topN = 20,
}: LlmsTxtArgs): string {
  const lines: string[] = [];
  lines.push(`# ${settings.siteName}`);
  lines.push("");
  lines.push(`> ${settings.tagline}`);
  lines.push("");
  lines.push(settings.description);
  lines.push("");
  lines.push("## The Translation Layer");
  lines.push("");
  lines.push(
    "Editorial essays on AI program risk, data architecture, and what " +
      "actually breaks in transformation. Practitioner-written, no vendor " +
      "pitches.",
  );
  lines.push("");
  const top = posts.slice(0, topN);
  for (const p of top) {
    const desc = p.excerpt ? `: ${p.excerpt}` : "";
    lines.push(`- [${p.title}](${siteUrl}/blog/${p.slug})${desc}`);
  }
  lines.push("");
  if (posts.length > topN) {
    lines.push(
      `Full corpus: [${siteUrl}/llms-full.txt](${siteUrl}/llms-full.txt) ` +
        `(${posts.length} posts).`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

export interface LlmsFullTxtArgs {
  settings: SiteSettings;
  siteUrl: string;
  posts: Array<PostSitemapEntry & { contentMd: string }>;
}

export function buildLlmsFullTxt({
  settings,
  siteUrl,
  posts,
}: LlmsFullTxtArgs): string {
  const lines: string[] = [];
  lines.push(`# ${settings.siteName} — Full corpus`);
  lines.push("");
  lines.push(`> ${settings.tagline}`);
  lines.push("");
  lines.push(
    `Every published essay from The Translation Layer (${posts.length} total). ` +
      `Updated automatically on every deploy.`,
  );
  lines.push("");
  for (const p of posts) {
    lines.push("---");
    lines.push("");
    lines.push(`# ${p.title}`);
    lines.push("");
    lines.push(`Source: ${siteUrl}/blog/${p.slug}`);
    if (p.categoryName) lines.push(`Category: ${p.categoryName}`);
    lines.push(`Published: ${p.publishedAt.toISOString().slice(0, 10)}`);
    if (p.lastReviewedAt) {
      lines.push(`Last reviewed: ${p.lastReviewedAt.toISOString().slice(0, 10)}`);
    }
    lines.push("");
    lines.push(p.contentMd);
    lines.push("");
  }
  return lines.join("\n");
}
