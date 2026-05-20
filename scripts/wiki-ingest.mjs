// pnpm wiki:ingest — scaffold an ingest from an external source.
//
// Karpathy Layer 1 → Layer 2 pattern: drop a source, the LLM reads it, writes
// a summary, updates the relevant entity/concept pages, refreshes the index,
// appends the log. This script is the scaffolding step — it places the raw
// content (or a pointer) under wiki/, surfaces overlapping pages, and prints
// a checklist for the LLM to follow.
//
// Usage:
//   pnpm wiki:ingest --url <url> [--in-repo|--external] [--slug <slug>]
//   pnpm wiki:ingest --file <path> [--in-repo|--external] [--slug <slug>]
//   pnpm wiki:ingest --paste [--in-repo|--external] --slug <slug>   (stdin)
//
// Placement:
//   --in-repo   wiki/raw/<slug>.md         (full text checked in; small public refs)
//   --external  wiki/raw-index/<slug>.md   (pointer + summary skeleton; default)
//
// The script does NOT write summaries, update entity pages, or touch the index
// or log — those are the LLM's job per Karpathy. The script's contract:
// produce a placed raw page + a checklist of what's likely affected.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return true;
  return next;
}

function hasFlag(name) {
  return args.includes(name);
}

const url = getFlag("--url");
const file = getFlag("--file");
const paste = hasFlag("--paste");
const inRepo = hasFlag("--in-repo");
const external = hasFlag("--external");
const slugOverride = getFlag("--slug");

if ([url, file, paste].filter(Boolean).length !== 1) {
  console.error(
    "Usage: pnpm wiki:ingest <--url <url> | --file <path> | --paste --slug <slug>> [--in-repo|--external] [--slug <slug>]",
  );
  process.exit(2);
}

if (inRepo && external) {
  console.error("[wiki-ingest] choose --in-repo OR --external, not both");
  process.exit(2);
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// =============================================================================
// Acquire the source
// =============================================================================

let title = null;
let rawText = ""; // markdown text we'll save when --in-repo
let sourceRef = ""; // URL or file path for the pointer / frontmatter
let sourceKind = ""; // "url" | "file" | "paste"

async function fetchAsMarkdown(targetUrl) {
  // Dynamic import so a missing turndown only fails the URL path, not the
  // file/paste paths (which don't need it).
  const { default: TurndownService } = await import("turndown");

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; archoslabs-wiki-ingest/1.0; +https://archoslabs.xyz)",
    },
  });
  if (!res.ok) {
    throw new Error(`fetch ${targetUrl} -> ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const titleMatch =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const extractedTitle = titleMatch
    ? titleMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : null;

  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  const markdown = td.turndown(html);

  return { title: extractedTitle, markdown };
}

if (url) {
  sourceKind = "url";
  sourceRef = url;
  console.error(`[wiki-ingest] fetching ${url} ...`);
  const fetched = await fetchAsMarkdown(url);
  title = fetched.title;
  rawText = fetched.markdown;
} else if (file) {
  sourceKind = "file";
  sourceRef = file;
  const absFile = path.resolve(file);
  if (!existsSync(absFile)) {
    console.error(`[wiki-ingest] file not found: ${absFile}`);
    process.exit(1);
  }
  rawText = readFileSync(absFile, "utf8");
  const firstH1 = rawText.match(/^#\s+(.+)$/m);
  title = firstH1 ? firstH1[1].trim() : path.basename(file, path.extname(file));
} else if (paste) {
  sourceKind = "paste";
  sourceRef = "(pasted)";
  rawText = readFileSync(0, "utf8"); // stdin
  if (!rawText.trim()) {
    console.error("[wiki-ingest] --paste requires content on stdin");
    process.exit(1);
  }
}

// Slug resolution
const slug = slugify(slugOverride ?? title ?? "ingested-source");
if (!slug) {
  console.error("[wiki-ingest] could not derive a slug — pass --slug <slug>");
  process.exit(1);
}

// =============================================================================
// Placement decision
// =============================================================================

const wikiRoot = path.join(process.cwd(), "wiki");
const rawDir = path.join(wikiRoot, "raw");
const rawIndexDir = path.join(wikiRoot, "raw-index");

let placement;
if (inRepo) placement = "in-repo";
else if (external) placement = "external";
else {
  // Default: external pointer (privacy-first, lighter repo). LLM can re-run
  // with --in-repo if the source is small + public + worth checking in.
  placement = "external";
  console.error(
    "[wiki-ingest] no placement flag given — defaulting to --external (pointer). Pass --in-repo to copy full text into wiki/raw/.",
  );
}

const targetDir = placement === "in-repo" ? rawDir : rawIndexDir;
const targetPath = path.join(targetDir, `${slug}.md`);
const relTargetPath = path.relative(process.cwd(), targetPath).replace(/\\/g, "/");

if (existsSync(targetPath)) {
  console.error(
    `[wiki-ingest] ${relTargetPath} already exists — pass --slug <new-slug> to override`,
  );
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

const today = todayIso();
const safeTitle = (title ?? slug).replace(/"/g, "'");
const category = placement === "in-repo" ? "raw" : "raw-index";

const frontmatter = `---
title: ${safeTitle}
category: ${category}
created: ${today}
updated: ${today}
source: ${sourceRef}
source_kind: ${sourceKind}
related:
---

`;

let body;
if (placement === "in-repo") {
  body = `> Ingested ${today} from \`${sourceRef}\`. This page is the raw source preserved verbatim. Summaries, entity updates, and concept extraction belong in the relevant \`wiki/concepts/\`, \`wiki/entities/\`, or \`wiki/synthesis/\` page — not here.\n\n${rawText.trim()}\n`;
} else {
  body = `Pointer to an external source. The full text is not stored in this repo — fetch via the \`source:\` field above when needed.\n\n## Summary\n\n_To be written by the LLM after reading the source. Should cite the source URL + capture the 3–5 takeaways that influence wiki/concepts or wiki/entities pages._\n\n## Pages this source touches\n\n_List the wiki pages updated as a result of ingesting this source._\n\n- \n`;
}

writeFileSync(targetPath, frontmatter + body);
console.error(`[wiki-ingest] wrote ${relTargetPath}`);

// =============================================================================
// Surface related wiki pages (overlap + graph neighbours)
// =============================================================================

function runOrEmpty(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

// Pull keyword candidates from the title and slug
const keywordSource = `${title ?? ""} ${slug.replace(/-/g, " ")}`.toLowerCase();
const stopwords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "by",
  "from",
  "as",
  "at",
  "is",
  "this",
  "that",
  "it",
  "be",
  "are",
]);
const keywords = [
  ...new Set(
    keywordSource
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !stopwords.has(w)),
  ),
].slice(0, 6);

const overlapHits = new Map();
for (const kw of keywords) {
  const out = runOrEmpty(`node scripts/wiki-search.mjs "${kw}"`);
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p || p === relTargetPath) continue;
    overlapHits.set(p, (overlapHits.get(p) ?? 0) + 1);
  }
}

const ranked = [...overlapHits.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.error("\n[wiki-ingest] checklist for the LLM:\n");
console.error(`  Slug:      ${slug}`);
console.error(`  Placement: ${placement} (${relTargetPath})`);
console.error(`  Title:     ${safeTitle}`);
console.error(`  Source:    ${sourceRef}`);
console.error("");
console.error("  Steps:");
console.error(
  "    1. Read the placed raw page.",
);
console.error(
  "    2. Decide which wiki/entities/ + wiki/concepts/ pages this source affects.",
);
console.error(
  "       Overlapping pages (search by keywords from the title):",
);
if (ranked.length === 0) {
  console.error("         (no overlap detected)");
} else {
  for (const [p, n] of ranked) {
    console.error(`         ${n}× ${p}`);
  }
}
console.error(
  "    3. For each affected page: update, add a [[" + slug + "]] cross-ref, refresh the `updated:` date.",
);
console.error(
  "    4. If the source introduces a new entity or concept worth its own page, create it under wiki/entities/ or wiki/concepts/.",
);
console.error(
  "    5. Update wiki/index.md — add the new raw page + any new entity/concept pages.",
);
console.error("    6. Append wiki/log.md:");
console.error("");
console.error(`         ## ${today} — Ingest: ${safeTitle}`);
console.error("");
console.error(
  `         Source: ${sourceRef}. Placed at \`${relTargetPath}\`. Touched: <list pages>.`,
);
console.error("");
console.error("    7. Run `pnpm wiki:graph build` to refresh the graph.");
console.error("    8. Run `pnpm wiki:lint` to verify no broken refs.");
console.error("");
