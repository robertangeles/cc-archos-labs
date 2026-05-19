// manifest.ts — per-post decisions log + summary stats.
//
// Outputs a Manifest object that records every transform decision for
// every post. Two consumers:
//   1. Stdout/stderr: pretty markdown summary written by the orchestrator
//   2. Filesystem: full JSON manifest at scripts/migrate-wp/manifest-{ISO}.json
//      for diffs across runs + audit trail
//
// Pure functions where possible (build + format); fs writes are isolated
// to writeManifest().

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Manifest, MigrationConfig, PostManifestEntry } from "./types";

export function emptyManifest(
  config: MigrationConfig,
  source: { databaseHost: string; databaseName: string; tablePrefix: string },
): Manifest {
  return {
    generatedAt: new Date().toISOString(),
    mode: config.mode,
    source,
    filters: {
      limit: config.limit,
      slug: config.slug,
      skipMedia: config.skipMedia,
      skipOg: config.skipOg,
      skipEmbed: config.skipEmbed,
    },
    totals: {
      extracted: 0,
      transformed: 0,
      polished: 0,
      embedded: 0,
      mediaRehosted: 0,
      ogGenerated: 0,
      inserted: 0,
      failed: 0,
      needsReview: 0,
    },
    posts: [],
  };
}

export function addEntry(manifest: Manifest, entry: PostManifestEntry): void {
  manifest.posts.push(entry);
  // Roll up totals based on the entry's status.
  const t = manifest.totals;
  // Status is the FURTHEST stage reached. Increment every stage <= it.
  const order: PostManifestEntry["status"][] = [
    "dry_run",
    "extracted",
    "transformed",
    "polished",
    "embedded",
    "media_rehosted",
    "og_generated",
    "inserted",
  ];
  const reachedIdx = order.indexOf(entry.status);
  for (let i = 0; i <= reachedIdx; i++) {
    const stage = order[i];
    if (stage === "extracted") t.extracted++;
    else if (stage === "transformed") t.transformed++;
    else if (stage === "polished") t.polished++;
    else if (stage === "embedded") t.embedded++;
    else if (stage === "media_rehosted") t.mediaRehosted++;
    else if (stage === "og_generated") t.ogGenerated++;
    else if (stage === "inserted") t.inserted++;
  }
  if (entry.status === "failed") t.failed++;
  if (entry.decisions.needsReview) t.needsReview++;
}

/**
 * Write the full Manifest as JSON to disk. Creates the parent dir if missing.
 */
export function writeManifest(manifest: Manifest, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
}

/**
 * Format a human-readable markdown summary of the manifest. Used for
 * stdout output at the end of a run.
 */
export function formatSummary(manifest: Manifest): string {
  const lines: string[] = [];
  lines.push(`# Migration manifest — ${manifest.mode}`);
  lines.push("");
  lines.push(`Generated: ${manifest.generatedAt}`);
  lines.push(
    `Source: ${manifest.source.databaseHost} / ${manifest.source.databaseName} (prefix \`${manifest.source.tablePrefix}\`)`,
  );
  if (manifest.filters.slug) {
    lines.push(`Filter: slug=${manifest.filters.slug}`);
  } else if (manifest.filters.limit) {
    lines.push(`Filter: first ${manifest.filters.limit} posts`);
  }
  const skipped: string[] = [];
  if (manifest.filters.skipMedia) skipped.push("media");
  if (manifest.filters.skipOg) skipped.push("og");
  if (manifest.filters.skipEmbed) skipped.push("embed");
  if (skipped.length) lines.push(`Skipped stages: ${skipped.join(", ")}`);
  lines.push("");
  lines.push(`## Totals`);
  lines.push("");
  lines.push("| Stage | Count |");
  lines.push("|---|---:|");
  lines.push(`| Extracted | ${manifest.totals.extracted} |`);
  lines.push(`| Transformed | ${manifest.totals.transformed} |`);
  lines.push(`| Polished (Claude) | ${manifest.totals.polished} |`);
  lines.push(`| Embedded (Voyage) | ${manifest.totals.embedded} |`);
  lines.push(`| Media rehosted (R2) | ${manifest.totals.mediaRehosted} |`);
  lines.push(`| OG images generated | ${manifest.totals.ogGenerated} |`);
  lines.push(`| Inserted (Postgres) | ${manifest.totals.inserted} |`);
  lines.push(`| **Needs review** | **${manifest.totals.needsReview}** |`);
  lines.push(`| **Failed** | **${manifest.totals.failed}** |`);
  lines.push("");

  if (manifest.totals.needsReview > 0) {
    lines.push(`## Needs review queue`);
    lines.push("");
    lines.push("| Slug | Reason |");
    lines.push("|---|---|");
    for (const p of manifest.posts) {
      if (!p.decisions.needsReview) continue;
      const reasons: string[] = [];
      if (p.decisions.currencyConcerns.length) {
        reasons.push(
          `currency: ${p.decisions.currencyConcerns.slice(0, 2).join(", ")}`,
        );
      }
      if (p.errors.length) reasons.push(`errors: ${p.errors[0]}`);
      lines.push(`| \`${p.slug}\` | ${reasons.join("; ") || "(see manifest)"} |`);
    }
    lines.push("");
  }

  if (manifest.totals.failed > 0) {
    lines.push(`## Failures`);
    lines.push("");
    lines.push("| Slug | Stage reached | Error |");
    lines.push("|---|---|---|");
    for (const p of manifest.posts) {
      if (p.status !== "failed") continue;
      lines.push(
        `| \`${p.slug}\` | ${p.status} | ${p.errors[0] ?? "(no message)"} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a per-post entry. Used by the orchestrator after each post
 * finishes (or fails). Returns a defaulted entry that the orchestrator
 * can spread into.
 */
export function buildEntry(post: {
  sourceWpId: number;
  slug: string;
  title: string;
}): PostManifestEntry {
  return {
    sourceWpId: post.sourceWpId,
    slug: post.slug,
    title: post.title,
    decisions: {
      categoryResolved: "",
      tagsKept: [],
      tagsFiltered: [],
      excerptSource: "wp",
      needsReview: false,
      currencyConcerns: [],
      inlineImageCount: 0,
      embeddingDim: null,
      ogGenerated: false,
    },
    errors: [],
    status: "extracted",
    durationMs: 0,
  };
}
