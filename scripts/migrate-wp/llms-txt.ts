// llms-txt.ts — regenerate /llms.txt and /llms-full.txt from the post table.
//
// Per AIEO scope baked into the design (CEO review's SEO+AIEO Strategy
// section): expose the corpus to AI crawlers via the llmstxt.org spec.
//
// Two files:
//   /llms.txt        curated short index — top 20 listed posts with one-line
//                    summaries. The "front page" for AI agents discovering
//                    the site.
//   /llms-full.txt   the complete corpus as plain text — title, url, full
//                    body markdown for every listed post.
//
// These are SERVED dynamically at /llms.txt and /llms-full.txt routes
// (app/llms.txt/route.ts + app/llms-full.txt/route.ts, Phase B work).
// This module is the build helper that exports the formatting functions
// those routes import. The migration script itself ALSO writes the files
// to disk for verification / out-of-band publishing.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Post } from "../../lib/db/schema";

const SITE_NAME = "Archos Labs — The Translation Layer";
const SITE_URL = "https://archoslabs.xyz";
const SITE_DESCRIPTION =
  "Practitioner essays on AI program risk, data architecture, and what actually breaks in enterprise transformation. By Rob Angeles.";

export interface LlmsTxtPost {
  slug: string;
  title: string;
  excerpt: string | null;
  contentMd: string;
  publishedAt: Date | null;
}

// =============================================================================
// /llms.txt — curated short index
// =============================================================================

export function buildLlmsTxt(posts: LlmsTxtPost[], limit = 20): string {
  const lines: string[] = [];
  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(`> ${SITE_DESCRIPTION}`);
  lines.push("");
  lines.push("## Recent essays");
  lines.push("");

  const sorted = [...posts].sort((a, b) => {
    const ad = a.publishedAt?.getTime() ?? 0;
    const bd = b.publishedAt?.getTime() ?? 0;
    return bd - ad;
  });

  for (const p of sorted.slice(0, limit)) {
    const url = `${SITE_URL}/blog/${p.slug}`;
    const excerpt = (p.excerpt ?? "").replace(/\s+/g, " ").trim();
    lines.push(`- [${p.title}](${url})${excerpt ? `: ${excerpt}` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// /llms-full.txt — full corpus as plain text
// =============================================================================

export function buildLlmsFullTxt(posts: LlmsTxtPost[]): string {
  const lines: string[] = [];
  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(`> ${SITE_DESCRIPTION}`);
  lines.push("");
  lines.push(`Site: ${SITE_URL}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Posts: ${posts.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const sorted = [...posts].sort((a, b) => {
    const ad = a.publishedAt?.getTime() ?? 0;
    const bd = b.publishedAt?.getTime() ?? 0;
    return bd - ad;
  });

  for (const p of sorted) {
    const url = `${SITE_URL}/blog/${p.slug}`;
    const date = p.publishedAt
      ? p.publishedAt.toISOString().slice(0, 10)
      : "unknown";
    lines.push(`# ${p.title}`);
    lines.push("");
    lines.push(`URL: ${url}`);
    lines.push(`Date: ${date}`);
    lines.push("");
    if (p.excerpt) {
      lines.push(p.excerpt);
      lines.push("");
    }
    lines.push(p.contentMd);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

// =============================================================================
// File writers — called by the orchestrator at end of `--apply` run
// =============================================================================

export function writeLlmsFiles(args: {
  posts: LlmsTxtPost[];
  outputDir: string;
}): { llmsPath: string; llmsFullPath: string } {
  mkdirSync(args.outputDir, { recursive: true });
  const llmsPath = `${args.outputDir}/llms.txt`;
  const llmsFullPath = `${args.outputDir}/llms-full.txt`;
  writeFileSync(llmsPath, buildLlmsTxt(args.posts));
  writeFileSync(llmsFullPath, buildLlmsFullTxt(args.posts));
  return { llmsPath, llmsFullPath };
}

/**
 * Convert a Drizzle Post select result into the lightweight shape this
 * module expects. Keeps the callers (orchestrator + future Next.js
 * routes) from depending on the full Post type.
 */
export function postToLlmsTxtPost(p: Post): LlmsTxtPost {
  // Drizzle returns timestamps as Date; defensive null-check covers an
  // older Postgres driver that might return strings.
  const pub =
    p.publishedAt instanceof Date
      ? p.publishedAt
      : p.publishedAt
        ? new Date(p.publishedAt)
        : null;
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    contentMd: p.contentMd,
    publishedAt: pub,
  };
}

// Ensure dirname is used — TS strict mode flags unused imports.
void dirname;
