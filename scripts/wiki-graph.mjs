// pnpm wiki:graph — build and query the wiki's reference graph.
//
// Per CLAUDE.md "LLM Wiki tooling": parses frontmatter `related:` fields and
// body `[[slug]]` refs into a node/edge graph stored at wiki/.graph.json
// (gitignored — regenerable artefact). The graph is the spine of the Karpathy
// Ingest + Lint ops: ingest uses `neighbors` to find related pages before
// updating; lint uses `broken` and `orphans` for the health pass.
//
// Subcommands:
//   build               rebuild wiki/.graph.json from frontmatter + [[refs]]
//   stats               node/edge counts + category breakdown
//   neighbors <slug>    outgoing + incoming edges for a page
//   orphans             pages with no edges (likely under-linked)
//   category <name>     all pages in a category
//   broken              [[slug]] refs that point to missing pages
//
// Slugs are the filename without `.md`. Same-slug collisions across folders
// are reported by `build` and treated as ambiguous (last-write wins; flagged).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const wikiRoot = path.join(process.cwd(), "wiki");
const graphPath = path.join(wikiRoot, ".graph.json");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(rawInput) {
  // Permissive YAML-ish parser — only handles the keys we use (title, category,
  // created, updated, related). Full YAML would be overkill for a five-field
  // frontmatter convention; if a key shape ever drifts beyond this, fix the
  // page, not the parser.
  //
  // Normalise line endings first — files on Windows commit as CRLF, which the
  // naive `---\n` check would miss.
  const raw = rawInput.replace(/\r\n/g, "\n");
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const fm = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    fm[m[1]] = m[2].trim();
  }
  return { frontmatter: fm, body };
}

function extractWikiRefs(text) {
  // Strip fenced code blocks and inline code spans first — refs inside
  // backticks (e.g. `[[slug]]` in instructional prose) are literal placeholders,
  // not wiki references.
  const stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const refs = new Set();
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    refs.add(m[1].trim());
  }
  return [...refs];
}

function build() {
  const files = walk(wikiRoot);
  const nodes = {};
  const slugIndex = {}; // slug -> [paths] (collision detection)

  for (const file of files) {
    const rel = path.relative(wikiRoot, file).replace(/\\/g, "/");
    const slug = path.basename(file, ".md");
    const folder = path.dirname(rel) === "." ? "_root" : path.dirname(rel);

    // README files are structural folder docs (when to use this folder, what
    // belongs here). They are not content pages — skip them from the graph so
    // they don't collide on slug across folders or pollute orphan/stats output.
    if (slug.toLowerCase() === "readme") continue;

    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const relatedRefs = extractWikiRefs(frontmatter.related ?? "");
    const bodyRefs = extractWikiRefs(body);
    const outgoing = [...new Set([...relatedRefs, ...bodyRefs])];

    slugIndex[slug] = slugIndex[slug] ?? [];
    slugIndex[slug].push(rel);

    nodes[slug] = {
      slug,
      path: rel,
      category: frontmatter.category ?? folder,
      title: frontmatter.title ?? slug,
      created: frontmatter.created ?? null,
      updated: frontmatter.updated ?? null,
      outgoing,
    };
  }

  // Edges: from each node, an edge per outgoing ref. Targets may not exist.
  const edges = [];
  for (const node of Object.values(nodes)) {
    for (const target of node.outgoing) {
      edges.push({ from: node.slug, to: target });
    }
  }

  const collisions = Object.entries(slugIndex)
    .filter(([, paths]) => paths.length > 1)
    .map(([slug, paths]) => ({ slug, paths }));

  const graph = {
    generated: new Date().toISOString(),
    nodes,
    edges,
    collisions,
  };

  writeFileSync(graphPath, JSON.stringify(graph, null, 2));

  console.log(
    `[wiki-graph] wrote ${graphPath.replace(process.cwd(), ".")} — ${Object.keys(nodes).length} nodes, ${edges.length} edges${collisions.length ? `, ${collisions.length} slug collisions` : ""}`,
  );

  if (collisions.length) {
    console.log("\nSlug collisions (same filename across folders):");
    for (const c of collisions) {
      console.log(`  ${c.slug}: ${c.paths.join(", ")}`);
    }
  }
}

function loadGraph() {
  try {
    return JSON.parse(readFileSync(graphPath, "utf8"));
  } catch {
    console.error(
      "[wiki-graph] no graph found — run `pnpm wiki:graph build` first",
    );
    process.exit(1);
  }
}

function stats() {
  const g = loadGraph();
  const byCategory = {};
  for (const node of Object.values(g.nodes)) {
    byCategory[node.category] = (byCategory[node.category] ?? 0) + 1;
  }
  console.log(`Nodes: ${Object.keys(g.nodes).length}`);
  console.log(`Edges: ${g.edges.length}`);
  console.log(`Collisions: ${g.collisions.length}`);
  console.log("\nBy category:");
  for (const [cat, n] of Object.entries(byCategory).sort()) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }
}

function neighbors(slug) {
  if (!slug) {
    console.error("Usage: pnpm wiki:graph neighbors <slug>");
    process.exit(2);
  }
  const g = loadGraph();
  const node = g.nodes[slug];
  if (!node) {
    console.error(`[wiki-graph] no page with slug "${slug}"`);
    process.exit(1);
  }
  const outgoing = g.edges
    .filter((e) => e.from === slug)
    .map((e) => e.to)
    .sort();
  const incoming = g.edges
    .filter((e) => e.to === slug)
    .map((e) => e.from)
    .sort();
  console.log(`${slug} — ${node.path}`);
  console.log(`\nOutgoing (${outgoing.length}):`);
  for (const t of outgoing) {
    const exists = g.nodes[t] ? "" : "  (broken)";
    console.log(`  -> ${t}${exists}`);
  }
  console.log(`\nIncoming (${incoming.length}):`);
  for (const s of incoming) {
    console.log(`  <- ${s}`);
  }
}

function orphans() {
  const g = loadGraph();
  const connected = new Set();
  for (const e of g.edges) {
    connected.add(e.from);
    if (g.nodes[e.to]) connected.add(e.to);
  }
  const isolated = Object.values(g.nodes)
    .filter((n) => !connected.has(n.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (isolated.length === 0) {
    console.log("No orphans.");
    return;
  }
  console.log(`${isolated.length} orphan${isolated.length === 1 ? "" : "s"}:`);
  for (const n of isolated) {
    console.log(`  ${n.slug} — ${n.path}`);
  }
}

function category(name) {
  if (!name) {
    console.error("Usage: pnpm wiki:graph category <name>");
    process.exit(2);
  }
  const g = loadGraph();
  const hits = Object.values(g.nodes)
    .filter((n) => n.category === name)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (hits.length === 0) {
    console.log(`No pages in category "${name}".`);
    return;
  }
  for (const n of hits) {
    console.log(`  ${n.slug.padEnd(50)} ${n.path}`);
  }
}

function broken() {
  const g = loadGraph();
  const breaks = g.edges.filter((e) => !g.nodes[e.to]);
  if (breaks.length === 0) {
    console.log("No broken refs.");
    return;
  }
  // Group by target so output is easier to scan
  const byTarget = {};
  for (const e of breaks) {
    byTarget[e.to] = byTarget[e.to] ?? [];
    byTarget[e.to].push(e.from);
  }
  console.log(`${breaks.length} broken ref${breaks.length === 1 ? "" : "s"}:`);
  for (const [target, sources] of Object.entries(byTarget).sort()) {
    console.log(`  [[${target}]] referenced by:`);
    for (const s of sources.sort()) {
      console.log(`    - ${s}`);
    }
  }
  // Non-zero exit so CI / lint catches broken refs
  process.exit(1);
}

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "build":
    build();
    break;
  case "stats":
    stats();
    break;
  case "neighbors":
    neighbors(arg);
    break;
  case "orphans":
    orphans();
    break;
  case "category":
    category(arg);
    break;
  case "broken":
    broken();
    break;
  default:
    console.error(
      "Usage: pnpm wiki:graph <build|stats|neighbors|orphans|category|broken> [arg]",
    );
    process.exit(2);
}
