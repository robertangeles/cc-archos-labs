// index.ts — migration orchestrator.
//
// Run via:
//   pnpm migrate-wp:dry-run                     # extract + transform, no writes
//   pnpm migrate-wp:apply                       # full pipeline
//   pnpm migrate-wp:dry-run -- --limit 5        # first 5 posts only
//   pnpm migrate-wp:dry-run -- --slug ai-foo    # single post by slug
//   pnpm migrate-wp:apply  -- --skip-media      # debug: skip R2 uploads
//
// Reads env from .env.local via `node --env-file=` (wired in package.json).
//
// Architecture: streaming-ish in spirit, batched in practice. Extract pulls
// ALL posts into memory (small corpus — 253 rows, ~1 MB total). Each post
// flows through the transform stages one at a time so failures are isolated
// (one post failing doesn't abort the others).

import { argv, env, exit, stdout, stderr } from "node:process";
import { performance } from "node:perf_hooks";
import { extractPosts, connectWp, ExtractError } from "./extract";
import { transformPost } from "./transform";
import {
  addEntry,
  buildEntry,
  emptyManifest,
  formatSummary,
  writeManifest,
} from "./manifest";
import type { MigrationConfig } from "./types";

// =============================================================================
// CLI parsing
// =============================================================================

function parseCli(): MigrationConfig {
  const args = argv.slice(2);
  const cfg: MigrationConfig = {
    mode: "dry_run",
    limit: null,
    slug: null,
    skipMedia: false,
    skipOg: false,
    skipEmbed: false,
    manifestPath: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--dry-run":
        cfg.mode = "dry_run";
        break;
      case "--apply":
        cfg.mode = "apply";
        break;
      case "--limit": {
        const n = parseInt(args[++i] ?? "", 10);
        if (!Number.isFinite(n) || n <= 0) {
          die(`--limit requires a positive integer (got ${args[i]})`);
        }
        cfg.limit = n;
        break;
      }
      case "--slug":
        cfg.slug = args[++i] ?? null;
        if (!cfg.slug) die("--slug requires a value");
        break;
      case "--skip-media":
        cfg.skipMedia = true;
        break;
      case "--skip-og":
        cfg.skipOg = true;
        break;
      case "--skip-embed":
        cfg.skipEmbed = true;
        break;
      case "--manifest":
        cfg.manifestPath = args[++i] ?? null;
        if (!cfg.manifestPath) die("--manifest requires a path");
        break;
      case "--help":
      case "-h":
        printUsage();
        exit(0);
      default:
        if (a.startsWith("--")) die(`Unknown flag: ${a}`);
    }
  }
  return cfg;
}

function printUsage(): void {
  stdout.write(`
scripts/migrate-wp — Translation Layer migration orchestrator.

Usage:
  pnpm migrate-wp:dry-run [options]
  pnpm migrate-wp:apply  [options]

Options:
  --dry-run          extract + transform only; no writes anywhere (default)
  --apply            full pipeline (Claude polish, Voyage, R2, Postgres)
  --limit N          only first N posts (post-date DESC)
  --slug NAME        only the post with this post_name (WP slug)
  --skip-media       skip R2 media rehost (apply mode only)
  --skip-og          skip OG image generation (apply mode only)
  --skip-embed       skip Voyage embedding (apply mode only)
  --manifest PATH    write JSON manifest to PATH (default: ./scripts/migrate-wp/manifest-{ISO}.json)
  -h, --help         show this message

Required env (.env.local):
  WP_DATABASE_URL    mysql://... source WordPress DB
  WP_TABLE_PREFIX    table prefix (e.g. uhiz_)
  DATABASE_URL       Archos Labs Postgres (apply mode)
  OPENROUTER_API_KEY for Claude polish (apply mode)
  VOYAGE_API_KEY     for embeddings (apply mode)
  R2_*               for media + OG (apply mode)
`);
}

function die(message: string): never {
  stderr.write(`ERROR: ${message}\n`);
  exit(1);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const cfg = parseCli();

  const wpUrl = env.WP_DATABASE_URL;
  const prefix = env.WP_TABLE_PREFIX || "wp_";
  if (!wpUrl) die("WP_DATABASE_URL is not set in .env.local");

  stderr.write(
    `Mode: ${cfg.mode}  ${cfg.limit ? `(limit ${cfg.limit})` : ""}  ${cfg.slug ? `(slug ${cfg.slug})` : ""}\n`,
  );

  const conn = await connectWp(wpUrl);
  const sourceInfo = {
    databaseHost: extractHost(wpUrl),
    databaseName: extractDbName(wpUrl),
    tablePrefix: prefix,
  };
  const manifest = emptyManifest(cfg, sourceInfo);

  try {
    // ---------- Stage 1: extract ----------
    stderr.write(`[extract] connecting + querying ...\n`);
    const extracted = await extractPosts(conn, prefix, {
      limit: cfg.limit,
      slug: cfg.slug,
    });
    stderr.write(`[extract] ${extracted.length} posts pulled\n`);

    // ---------- Per-post pipeline ----------
    for (const post of extracted) {
      const t0 = performance.now();
      const entry = buildEntry(post);
      entry.decisions.categoryResolved = post.category.slug;
      try {
        // ----- Stage 2: transform (HTML → markdown) -----
        const transformed = transformPost(post);
        entry.status = "transformed";

        // Track image references (count <img> tags in markdown; rehost
        // happens in apply mode only — stage 5).
        const imgMatches = transformed.contentMd.match(/!\[[^\]]*\]\(/g);
        entry.decisions.inlineImageCount = imgMatches ? imgMatches.length : 0;

        if (cfg.mode === "dry_run") {
          // Dry-run stops here. Capture what we know for the manifest.
          entry.status = "dry_run";
          entry.decisions.tagsKept = transformed.tags.map((t) => t.slug);
          entry.durationMs = Math.round(performance.now() - t0);
          addEntry(manifest, entry);
          continue;
        }

        // Apply mode: stages 3–8 ship in Checkpoint 2 of this PR.
        // Until then, --apply behaves like --dry-run with a warning.
        if (cfg.mode === "apply") {
          stderr.write(
            `[warn] --apply pipeline (Claude/Voyage/R2/Postgres) is not yet wired in this commit. Falling through to dry-run for ${post.slug}.\n`,
          );
          entry.status = "dry_run";
          entry.decisions.tagsKept = transformed.tags.map((t) => t.slug);
          entry.durationMs = Math.round(performance.now() - t0);
          addEntry(manifest, entry);
          continue;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.status = "failed";
        entry.errors.push(msg);
        if (err instanceof ExtractError) {
          stderr.write(`[extract] post ${post.slug} failed: ${msg}\n`);
        } else {
          stderr.write(`[transform] post ${post.slug} failed: ${msg}\n`);
        }
        entry.durationMs = Math.round(performance.now() - t0);
        addEntry(manifest, entry);
      }
    }
  } finally {
    await conn.end();
  }

  // ---------- Output ----------
  const outPath =
    cfg.manifestPath ||
    `./scripts/migrate-wp/manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeManifest(manifest, outPath);
  stderr.write(`[manifest] written to ${outPath}\n`);

  stdout.write(formatSummary(manifest) + "\n");

  // Exit non-zero if any posts failed (helps CI detect partial-success).
  if (manifest.totals.failed > 0) {
    stderr.write(
      `[exit] ${manifest.totals.failed} post(s) failed. See manifest for details.\n`,
    );
    exit(1);
  }
}

// =============================================================================
// Utilities
// =============================================================================

function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return "(unparseable)";
  }
}

function extractDbName(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, "") || "(unknown)";
  } catch {
    return "(unparseable)";
  }
}

main().catch((err) => {
  stderr.write(
    `FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(1);
});
