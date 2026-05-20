// pnpm wiki:lint — periodic health check across wiki/.
//
// Karpathy Lint op: contradictions, stale claims, orphans, missing
// cross-references, data gaps. Most of those need an LLM to judge; this
// script catches the mechanical issues so the LLM can focus on the rest.
//
// Checks (mechanical):
//   1. Broken [[refs]]                      (delegates to wiki-graph build)
//   2. Orphan pages                          (delegates to wiki-graph orphans)
//   3. Frontmatter validation                (required fields, dates)
//   4. Index drift                           (disk vs wiki/index.md)
//   5. Stale-page heuristic                  (linked from recent, itself stale)
//   6. Empty-folder check                    (which categories have zero pages)
//   7. Date sanity                           (no future-dated pages)
//
// Exit code:
//   0 — clean (or warnings only)
//   1 — hard error (broken refs, missing required frontmatter, index drift)
//
// Output is a markdown report on stdout — the LLM reads it and acts.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const wikiRoot = path.join(process.cwd(), "wiki");
const graphPath = path.join(wikiRoot, ".graph.json");
const indexPath = path.join(wikiRoot, "index.md");

const todayIso = new Date().toISOString().slice(0, 10);

const STALE_DAYS = 90; // page updated > 90d ago = candidate for refresh
const RECENT_DAYS = 30; // page updated < 30d = "recent" anchor

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z").getTime();
  const b = new Date(isoB + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function parseFrontmatter(rawInput) {
  // Normalise CRLF -> LF first — Windows commits often land as CRLF and the
  // naive `---\n` startsWith check would miss those files entirely.
  const raw = rawInput.replace(/\r\n/g, "\n");
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const fmBlock = raw.slice(4, end);
  const fm = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    fm[m[1]] = m[2].trim();
  }
  return fm;
}

// Run wiki-graph build so we always lint against a fresh graph
function runGraphBuild() {
  try {
    execSync("node scripts/wiki-graph.mjs build", {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (err) {
    console.error("[wiki-lint] graph build failed:", err.message);
    process.exit(1);
  }
}

function loadGraph() {
  if (!existsSync(graphPath)) {
    console.error("[wiki-lint] no graph found after build");
    process.exit(1);
  }
  return JSON.parse(readFileSync(graphPath, "utf8"));
}

runGraphBuild();
const graph = loadGraph();

const files = walk(wikiRoot);

const hardErrors = [];
const warnings = [];

// =============================================================================
// 1. Broken refs (from graph)
// =============================================================================

const brokenEdges = graph.edges.filter((e) => !graph.nodes[e.to]);
if (brokenEdges.length) {
  const byTarget = {};
  for (const e of brokenEdges) {
    byTarget[e.to] = byTarget[e.to] ?? [];
    byTarget[e.to].push(e.from);
  }
  for (const [target, sources] of Object.entries(byTarget)) {
    hardErrors.push(
      `broken ref [[${target}]] — referenced by: ${sources.join(", ")}`,
    );
  }
}

// =============================================================================
// 2. Orphan pages (no incoming, no outgoing)
// =============================================================================

const connected = new Set();
for (const e of graph.edges) {
  connected.add(e.from);
  if (graph.nodes[e.to]) connected.add(e.to);
}
const orphans = Object.values(graph.nodes)
  .filter((n) => !connected.has(n.slug))
  .map((n) => n.slug);

// Index, log, and state are intentionally hub pages that may not be linked
// FROM other pages by slug (they're referenced by tooling). README files are
// structural docs for a folder, not content pages. These aren't real orphans.
const orphanWhitelist = new Set(["index", "log", "state"]);
const realOrphans = orphans.filter(
  (s) => !orphanWhitelist.has(s) && s.toLowerCase() !== "readme",
);
for (const slug of realOrphans) {
  warnings.push(`orphan page (no incoming or outgoing edges): ${slug}`);
}

// =============================================================================
// 3. Frontmatter validation
// =============================================================================

const requiredFields = ["title", "category", "created", "updated"];
const dateFields = ["created", "updated"];
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const pagesMeta = []; // {slug, path, created, updated, category}

for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  const raw = readFileSync(file, "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm) {
    // state.md and wiki/raw/README.md may legitimately have no frontmatter —
    // skip the README pattern but still flag everything else
    if (path.basename(file).toLowerCase() === "readme.md") continue;
    hardErrors.push(`missing frontmatter: ${rel}`);
    continue;
  }

  // Auto-generated pages use `generated:` instead of `created`/`updated`.
  // Same schema, different lifecycle — skip the date-pair requirement for them.
  const isAutoGenerated = Boolean(fm.generated);

  for (const f of requiredFields) {
    if (!fm[f]) {
      if (isAutoGenerated && (f === "created" || f === "updated")) continue;
      hardErrors.push(`missing frontmatter field "${f}": ${rel}`);
    }
  }

  for (const f of dateFields) {
    if (fm[f] && !dateRe.test(fm[f])) {
      hardErrors.push(`invalid date in "${f}" (need YYYY-MM-DD): ${rel}`);
    }
  }

  if (fm.created && fm.updated && dateRe.test(fm.created) && dateRe.test(fm.updated)) {
    if (fm.created > fm.updated) {
      hardErrors.push(`created > updated: ${rel} (${fm.created} > ${fm.updated})`);
    }
  }

  // Date sanity: no future-dated pages
  if (fm.updated && dateRe.test(fm.updated) && fm.updated > todayIso) {
    warnings.push(`future-dated updated field: ${rel} (${fm.updated})`);
  }
  if (fm.created && dateRe.test(fm.created) && fm.created > todayIso) {
    warnings.push(`future-dated created field: ${rel} (${fm.created})`);
  }

  pagesMeta.push({
    slug: path.basename(file, ".md"),
    path: rel,
    created: fm.created ?? null,
    updated: fm.updated ?? null,
    category: fm.category ?? null,
  });
}

// =============================================================================
// 4. Index drift — disk vs wiki/index.md
// =============================================================================

if (existsSync(indexPath)) {
  const indexBody = readFileSync(indexPath, "utf8");
  const indexedPaths = new Set();
  const linkRe = /\]\(([^)]+\.md)\)/g;
  let m;
  while ((m = linkRe.exec(indexBody)) !== null) {
    // index.md links are relative — "entities/about-page.md" etc.
    indexedPaths.add(m[1].replace(/\\/g, "/"));
  }

  // Pages on disk that should be in the index but aren't.
  // We exclude index.md, log.md, state.md, README.md, anything under wiki/raw/
  // and wiki/raw-index/ may or may not be indexed depending on importance
  // (Karpathy: index is content-oriented, not a mechanical file listing).
  const indexableCategories = new Set([
    "entities",
    "concepts",
    "decisions",
    "synthesis",
    "lessons-learned",
    "backlog",
    "runbooks",
    "raw-index",
  ]);

  for (const file of files) {
    const rel = path.relative(wikiRoot, file).replace(/\\/g, "/");
    const folder = path.dirname(rel);
    if (!indexableCategories.has(folder)) continue;
    if (path.basename(rel).toLowerCase() === "readme.md") continue;
    if (!indexedPaths.has(rel)) {
      warnings.push(`on disk but not in wiki/index.md: ${rel}`);
    }
  }

  // Indexed paths missing from disk
  for (const p of indexedPaths) {
    const abs = path.join(wikiRoot, p);
    if (!existsSync(abs)) {
      hardErrors.push(`wiki/index.md links a missing file: ${p}`);
    }
  }
}

// =============================================================================
// 5. Stale-page heuristic
//    A page is "stale" if:
//      - its `updated` is > STALE_DAYS old
//      - AND a page that links TO it has been `updated` < RECENT_DAYS ago
//    (i.e. the wiki kept evolving around it; the stale page is likely behind.)
// =============================================================================

const metaBySlug = new Map(pagesMeta.map((p) => [p.slug, p]));

for (const node of Object.values(graph.nodes)) {
  const meta = metaBySlug.get(node.slug);
  if (!meta || !meta.updated || !dateRe.test(meta.updated)) continue;
  const ageDays = daysBetween(meta.updated, todayIso);
  if (ageDays < STALE_DAYS) continue;

  // Find pages that link TO this one and are themselves recent
  const incoming = graph.edges
    .filter((e) => e.to === node.slug)
    .map((e) => metaBySlug.get(e.from))
    .filter((m) => m && m.updated && dateRe.test(m.updated))
    .filter((m) => daysBetween(m.updated, todayIso) < RECENT_DAYS);

  if (incoming.length > 0) {
    warnings.push(
      `stale page: ${meta.path} (updated ${meta.updated}, ${ageDays}d) — linked from recently-updated: ${incoming.map((i) => i.slug).join(", ")}`,
    );
  }
}

// =============================================================================
// 6. Empty-folder check (data gaps)
// =============================================================================

const expectedFolders = [
  "entities",
  "concepts",
  "decisions",
  "synthesis",
  "lessons-learned",
  "backlog",
  "raw-index",
  "raw",
  "runbooks",
];
for (const folder of expectedFolders) {
  const dir = path.join(wikiRoot, folder);
  if (!existsSync(dir)) {
    warnings.push(`expected folder missing: wiki/${folder}/`);
    continue;
  }
  const allMd = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const contentMd = allMd.filter((f) => f.toLowerCase() !== "readme.md");
  // If the folder has a README, treat it as intentionally tracked + waiting —
  // the README is the signal "this folder exists by design, content emerges
  // when it emerges". Suppress the warning to avoid permanent noise.
  const hasReadme = allMd.length > contentMd.length;
  if (contentMd.length === 0 && !hasReadme) {
    warnings.push(`empty category folder: wiki/${folder}/ (no pages yet)`);
  }
}

// =============================================================================
// Report
// =============================================================================

console.log(`# Wiki lint report — ${todayIso}\n`);
console.log(
  `Nodes: ${Object.keys(graph.nodes).length}  |  Edges: ${graph.edges.length}  |  Hard errors: ${hardErrors.length}  |  Warnings: ${warnings.length}\n`,
);

if (hardErrors.length === 0 && warnings.length === 0) {
  console.log("Clean.\n");
  process.exit(0);
}

if (hardErrors.length) {
  console.log(`## Hard errors (${hardErrors.length})\n`);
  for (const e of hardErrors) console.log(`- ${e}`);
  console.log("");
}

if (warnings.length) {
  console.log(`## Warnings (${warnings.length})\n`);
  for (const w of warnings) console.log(`- ${w}`);
  console.log("");
}

process.exit(hardErrors.length > 0 ? 1 : 0);
