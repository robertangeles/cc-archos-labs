// pnpm wiki:search — local grep across wiki/ markdown.
//
// Per CLAUDE.md "LLM Wiki tooling": reach for this BEFORE reading full pages
// to keep token use down. Karpathy-style ops: search the wiki, don't re-read
// every page from scratch.
//
// Usage:
//   pnpm wiki:search <query>          # list matching wiki page paths
//   pnpm wiki:search -c <query>       # add 2 lines of context per match
//
// Output is line-oriented and grep-friendly so other scripts can pipe it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const withContext = args[0] === "-c";
const query = (withContext ? args.slice(1) : args).join(" ").trim();

if (!query) {
  console.error("Usage: pnpm wiki:search [-c] <query>");
  process.exit(2);
}

const wikiRoot = path.join(process.cwd(), "wiki");

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

const needle = query.toLowerCase();
const files = walk(wikiRoot);

let hitCount = 0;

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      matches.push(i);
    }
  }
  if (matches.length === 0) continue;
  hitCount += matches.length;

  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  console.log(rel);

  if (!withContext) continue;

  for (const lineIdx of matches) {
    const start = Math.max(0, lineIdx - 1);
    const end = Math.min(lines.length - 1, lineIdx + 1);
    for (let j = start; j <= end; j++) {
      const prefix = j === lineIdx ? ">" : " ";
      console.log(`  ${prefix} ${j + 1}: ${lines[j]}`);
    }
    console.log("");
  }
}

if (hitCount === 0) {
  console.error(`[wiki-search] no matches for "${query}"`);
  process.exit(1);
}
