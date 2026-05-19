// index.ts — migration orchestrator.
//
// Run via:
//   pnpm migrate-wp:dry-run                     # extract + transform, no writes
//   pnpm migrate-wp:apply                       # full pipeline
//   pnpm migrate-wp:dry-run -- --limit 5        # first 5 posts only
//   pnpm migrate-wp:dry-run -- --slug ai-foo    # single post by slug
//   pnpm migrate-wp:apply  -- --skip-media      # debug: skip R2 uploads
//   pnpm migrate-wp:apply  -- --skip-embed      # debug: skip Voyage
//
// Reads env from .env.local via `node --env-file=` (wired in package.json).
//
// Per-post pipeline: each post flows through the stages one at a time so
// failures are isolated (one post failing doesn't abort the others).
// Each post's progress + decisions land in the manifest.

import { argv, env, exit, stdout, stderr } from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  extractPosts,
  connectWp,
  fetchTagFrequencies,
  ExtractError,
} from "./extract";
import { transformPost } from "./transform";
import { polishPost } from "./claude-polish";
import { embedPost, EmbedError } from "./embed";
import { rehostMedia, r2ConfigFromEnv } from "./media-rehost";
import { generateOgImage, wasOgGenerated } from "./og-generate";
import {
  connectDb,
  closeDb,
  ensureAuthor,
  ensureCategory,
  upsertPost,
  insertRevision,
} from "./insert";
import { buildRedirectConfig } from "./redirect-rules";
import {
  buildLlmsTxt,
  buildLlmsFullTxt,
} from "./llms-txt";
import {
  addEntry,
  buildEntry,
  emptyManifest,
  formatSummary,
  writeManifest,
} from "./manifest";
import type {
  EmbeddedPost,
  MediaRehostedPost,
  MigrationConfig,
  OgGeneratedPost,
  PolishedPost,
  TransformedPost,
} from "./types";

const OUTPUT_DIR = "./scripts/migrate-wp/output";

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
  --manifest PATH    write JSON manifest to PATH (default: ./scripts/migrate-wp/output/manifest-{ISO}.json)
  -h, --help         show this message

Required env (.env.local):
  WP_DATABASE_URL    mysql://... source WordPress DB
  WP_TABLE_PREFIX    table prefix (e.g. uhiz_)
  Apply mode also requires:
    DATABASE_URL       Archos Labs Postgres
    OPENROUTER_API_KEY for Claude polish
    VOYAGE_API_KEY     for embeddings
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_BUCKET, R2_PUBLIC_URL  for media rehost
`);
}

function die(message: string): never {
  stderr.write(`ERROR: ${message}\n`);
  exit(1);
}

// =============================================================================
// Apply-mode env validation
// =============================================================================

function validateApplyEnv(cfg: MigrationConfig): void {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.OPENROUTER_API_KEY) missing.push("OPENROUTER_API_KEY");
  if (!cfg.skipEmbed && !env.VOYAGE_API_KEY) missing.push("VOYAGE_API_KEY");
  if (!cfg.skipMedia) {
    if (!env.R2_ACCOUNT_ID) missing.push("R2_ACCOUNT_ID");
    if (!env.R2_API_TOKEN) missing.push("R2_API_TOKEN");
    if (!env.R2_BUCKET) missing.push("R2_BUCKET");
    if (!env.R2_PUBLIC_URL) missing.push("R2_PUBLIC_URL");
  }
  if (missing.length) {
    die(`Apply mode requires env: ${missing.join(", ")}`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const cfg = parseCli();

  const wpUrl = env.WP_DATABASE_URL;
  const prefix = env.WP_TABLE_PREFIX || "wp_";
  if (!wpUrl) die("WP_DATABASE_URL is not set in .env.local");

  if (cfg.mode === "apply") validateApplyEnv(cfg);

  stderr.write(
    `Mode: ${cfg.mode}  ${cfg.limit ? `(limit ${cfg.limit})` : ""}  ${cfg.slug ? `(slug ${cfg.slug})` : ""}\n`,
  );

  const wpConn = await connectWp(wpUrl);
  const sourceInfo = {
    databaseHost: extractHost(wpUrl),
    databaseName: extractDbName(wpUrl),
    tablePrefix: prefix,
  };
  const manifest = emptyManifest(cfg, sourceInfo);

  // Apply-mode setup: DB handle, R2 client, tag-allowlist.
  const applyEnv =
    cfg.mode === "apply" ? await setupApplyResources(cfg) : null;

  try {
    // ---------- Stage 1: extract ----------
    stderr.write(`[extract] connecting + querying ...\n`);
    const extracted = await extractPosts(wpConn, prefix, {
      limit: cfg.limit,
      slug: cfg.slug,
    });
    stderr.write(`[extract] ${extracted.length} posts pulled\n`);

    // ---------- Per-post pipeline ----------
    for (const post of extracted) {
      await processPost(post, cfg, manifest, applyEnv);
    }
  } finally {
    await wpConn.end();
    if (applyEnv) await closeDb(applyEnv.dbHandle);
  }

  // ---------- Side outputs (apply mode only) ----------
  if (cfg.mode === "apply") {
    writeSideOutputs(manifest, applyEnv!);
  }

  // ---------- Manifest output ----------
  const outPath =
    cfg.manifestPath ||
    join(
      OUTPUT_DIR,
      `manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  writeManifest(manifest, outPath);
  stderr.write(`[manifest] written to ${outPath}\n`);

  stdout.write(formatSummary(manifest) + "\n");

  if (manifest.totals.failed > 0) {
    stderr.write(
      `[exit] ${manifest.totals.failed} post(s) failed. See manifest for details.\n`,
    );
    exit(1);
  }
}

// =============================================================================
// Apply-mode resource setup
// =============================================================================

interface ApplyResources {
  dbHandle: ReturnType<typeof connectDb>;
  r2Config: ReturnType<typeof r2ConfigFromEnv> | null;
  tagAllowlist: Map<string, number>;
}

async function setupApplyResources(
  cfg: MigrationConfig,
): Promise<ApplyResources> {
  const dbHandle = connectDb();

  // R2 (unless skipped). Bearer-auth via Cloudflare REST API — no SDK client.
  let r2Config: ApplyResources["r2Config"] = null;
  if (!cfg.skipMedia) {
    r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      die("R2_* env missing despite --skip-media not set");
    }
  }

  // Tag allowlist — fetched ONCE before per-post loop (avoid 253 round-trips).
  const wpConn = await connectWp(env.WP_DATABASE_URL!);
  const tagAllowlist = await fetchTagFrequencies(
    wpConn,
    env.WP_TABLE_PREFIX || "wp_",
  );
  await wpConn.end();
  stderr.write(
    `[setup] tag allowlist: ${tagAllowlist.size} tags (filter is count >= 2)\n`,
  );

  return { dbHandle, r2Config, tagAllowlist };
}

// =============================================================================
// Per-post pipeline
// =============================================================================

async function processPost(
  source: Awaited<ReturnType<typeof extractPosts>>[number],
  cfg: MigrationConfig,
  manifest: ReturnType<typeof emptyManifest>,
  applyEnv: ApplyResources | null,
): Promise<void> {
  const t0 = performance.now();
  const entry = buildEntry(source);
  entry.decisions.categoryResolved = source.category.slug;

  try {
    // Stage 2: transform
    const transformed: TransformedPost = transformPost(source);
    entry.status = "transformed";
    const imgMatches = transformed.contentMd.match(/!\[[^\]]*\]\(/g);
    entry.decisions.inlineImageCount = imgMatches ? imgMatches.length : 0;

    if (cfg.mode === "dry_run") {
      entry.status = "dry_run";
      entry.decisions.tagsKept = transformed.tags.map((t) => t.slug);
      finalise(entry, manifest, t0);
      return;
    }

    if (!applyEnv) throw new Error("Apply env not initialised");

    // Stage 3: Claude polish
    const polished: PolishedPost = await polishPost(transformed, {
      tagAllowlist: applyEnv.tagAllowlist,
    });
    entry.status = "polished";
    entry.decisions.excerptSource = polished.excerpt
      ? polished.excerpt === transformed.rawExcerpt
        ? "wp"
        : "claude"
      : "generated";
    entry.decisions.currencyConcerns = polished.currencyConcerns;
    entry.decisions.tagsKept = polished.claudeTags;
    // Tags the WP source had that the allowlist rejected (count < 2)
    entry.decisions.tagsFiltered = transformed.tags
      .filter((t) => (applyEnv.tagAllowlist.get(t.slug) ?? 0) < 2)
      .map((t) => t.slug);
    entry.decisions.needsReview = polished.needsReview;

    // Stage 4: Voyage embedding
    let embedded: EmbeddedPost;
    if (cfg.skipEmbed) {
      embedded = { ...polished, embedding: [] };
    } else {
      embedded = await embedPost(polished);
      entry.status = "embedded";
      entry.decisions.embeddingDim = embedded.embedding.length;
    }

    // Stage 5: media rehost (R2 via Bearer auth + Cloudflare REST API)
    let rehosted: MediaRehostedPost;
    if (cfg.skipMedia || !applyEnv.r2Config) {
      rehosted = {
        ...embedded,
        contentMdRehosted: embedded.contentMd,
        featuredImageR2Url: embedded.featuredImage?.source_url ?? "",
        inlineImageCount: 0,
      };
    } else {
      rehosted = await rehostMedia(embedded, {
        config: applyEnv.r2Config,
      });
      entry.status = "media_rehosted";
      entry.decisions.inlineImageCount = rehosted.inlineImageCount;
    }

    // Stage 6: OG image (STUBBED — see og-generate.ts)
    const ogGenerated: OgGeneratedPost = await generateOgImage(rehosted, {
      enabled: !cfg.skipOg,
    });
    if (wasOgGenerated(ogGenerated)) {
      entry.status = "og_generated";
      entry.decisions.ogGenerated = true;
    }

    // Stage 7: insert (Postgres)
    const authorId = await ensureAuthor(applyEnv.dbHandle.db, source.author);
    const categoryId = await ensureCategory(
      applyEnv.dbHandle.db,
      source.category,
    );
    const result = await upsertPost(
      applyEnv.dbHandle.db,
      ogGenerated,
      authorId,
      categoryId,
      polished.claudeTags,
    );

    // Stage 8: append revision
    await insertRevision(
      applyEnv.dbHandle.db,
      result.postId,
      ogGenerated,
      ogGenerated.contentMdRehosted || ogGenerated.contentMd,
      result.diffSizePct,
    );

    entry.status = "inserted";
    finalise(entry, manifest, t0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entry.status = "failed";
    entry.errors.push(msg);
    entry.decisions.needsReview = true;
    if (err instanceof ExtractError) {
      stderr.write(`[extract] post ${source.slug} failed: ${msg}\n`);
    } else if (err instanceof EmbedError) {
      stderr.write(`[embed] post ${source.slug} failed: ${msg}\n`);
    } else {
      stderr.write(`[pipeline] post ${source.slug} failed: ${msg}\n`);
    }
    finalise(entry, manifest, t0);
  }
}

function finalise(
  entry: ReturnType<typeof buildEntry>,
  manifest: ReturnType<typeof emptyManifest>,
  t0: number,
): void {
  entry.durationMs = Math.round(performance.now() - t0);
  addEntry(manifest, entry);
}

// =============================================================================
// Side outputs (apply mode)
// =============================================================================

function writeSideOutputs(
  manifest: ReturnType<typeof emptyManifest>,
  _applyEnv: ApplyResources,
): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Redirect rules — both formats, caller picks which to deploy.
  writeFileSync(
    join(OUTPUT_DIR, "redirect.htaccess"),
    buildRedirectConfig("htaccess"),
  );
  writeFileSync(
    join(OUTPUT_DIR, "redirect.nginx.conf"),
    buildRedirectConfig("nginx"),
  );
  stderr.write(`[output] redirect rules written to ${OUTPUT_DIR}/redirect.*\n`);

  // 2. /llms.txt + /llms-full.txt — built from the manifest's polished
  //    posts (not the DB; the migration may not have flipped the feature
  //    flag yet, so /blog isn't publicly serving). The Phase B Next.js
  //    routes will regenerate these from the DB on every deploy.
  //
  //    We use the manifest's records here as a one-shot generation;
  //    the manifest contains slug + title + excerpt for every successful
  //    insert. For body content we don't have it in the manifest (kept
  //    out for size). The script-written llms-full.txt is therefore a
  //    metadata-only version; the runtime route will produce the full
  //    body version.
  const llmsPostsLight = manifest.posts
    .filter((p) => p.status === "inserted")
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: null,
      contentMd: "",
      publishedAt: null,
    }));
  writeFileSync(join(OUTPUT_DIR, "llms.txt"), buildLlmsTxt(llmsPostsLight));
  writeFileSync(
    join(OUTPUT_DIR, "llms-full.txt"),
    buildLlmsFullTxt(llmsPostsLight),
  );
  stderr.write(
    `[output] llms.txt + llms-full.txt written to ${OUTPUT_DIR}/ (metadata-only; runtime route in Phase B serves full body)\n`,
  );
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
