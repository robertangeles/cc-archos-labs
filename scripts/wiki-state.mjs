// pnpm wiki:state — regenerate wiki/state.md from the git-tracked file tree.
//
// Per CLAUDE.md "LLM Wiki" rule: this file is the source of truth for ship
// state. Agents must read wiki/state.md (not wiki/backlog/) before claiming
// a route, API endpoint, or component does not exist. Backlog files describe
// intent; this file describes reality.
//
// Walks the output of `git ls-files` (respects .gitignore) and writes three
// tables to wiki/state.md:
//   - Routes        (app/**/page.tsx)
//   - API endpoints (app/api/**/route.ts)
//   - Components    (components/**/*.tsx)
//
// Each row carries the last-commit ISO date for the file. New files (no git
// history yet) show "unknown" until first commit.
//
// Do not hand-edit wiki/state.md — the file is regenerated on every commit
// touching app/ or components/ via the .husky/pre-commit hook.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function git(args) {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function lastCommitDate(filePath) {
  // Quote the path for cross-platform safety; Windows + spaces both matter.
  const iso = git(`log -1 --format=%aI -- "${filePath}"`);
  return iso || null;
}

function shortDate(iso) {
  return iso ? iso.slice(0, 10) : "unknown";
}

const trackedFiles = git("ls-files").split("\n").filter(Boolean);

const routes = [];
const endpoints = [];
const components = [];

for (const raw of trackedFiles) {
  // Normalize Windows backslashes; git ls-files already uses forward slashes
  // but we normalize defensively in case anyone runs this differently.
  const file = raw.replace(/\\/g, "/");

  if (file.startsWith("app/api/") && file.endsWith("/route.ts")) {
    const endpoint =
      "/" + file.replace(/^app\//, "").replace(/\/route\.ts$/, "");
    endpoints.push({ endpoint, file, shipped: lastCommitDate(file) });
    continue;
  }

  if (file === "app/page.tsx") {
    routes.push({ route: "/", file, shipped: lastCommitDate(file) });
    continue;
  }

  if (file.startsWith("app/") && file.endsWith("/page.tsx")) {
    const segment = file.replace(/^app\//, "").replace(/\/page\.tsx$/, "");
    routes.push({ route: "/" + segment, file, shipped: lastCommitDate(file) });
    continue;
  }

  if (file.startsWith("components/") && /\.tsx?$/.test(file)) {
    components.push({ file, shipped: lastCommitDate(file) });
  }
}

routes.sort((a, b) => a.route.localeCompare(b.route));
endpoints.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
components.sort((a, b) => a.file.localeCompare(b.file));

const now = new Date().toISOString();

let out = "";
out += "---\n";
out += "title: Project state — auto-generated\n";
out += "category: synthesis\n";
out += `generated: ${now}\n`;
out += "generator: scripts/wiki-state.mjs\n";
out += "---\n\n";
out +=
  "Auto-generated snapshot of what is currently shipped. **Source of truth for ship state.** Read this before claiming any route, API endpoint, or component does not exist.\n\n";
out +=
  "Do not hand-edit. Regenerate with `pnpm wiki:state` or stage any change under `app/` or `components/` to fire the pre-commit hook.\n\n";

out += `## Routes (${routes.length})\n\n`;
out += "| Route | File | Last shipped |\n";
out += "|-------|------|--------------|\n";
for (const r of routes) {
  out += `| \`${r.route}\` | [${r.file}](../${r.file}) | ${shortDate(r.shipped)} |\n`;
}
out += "\n";

out += `## API endpoints (${endpoints.length})\n\n`;
out += "| Endpoint | File | Last shipped |\n";
out += "|----------|------|--------------|\n";
for (const e of endpoints) {
  out += `| \`${e.endpoint}\` | [${e.file}](../${e.file}) | ${shortDate(e.shipped)} |\n`;
}
out += "\n";

out += `## Components (${components.length})\n\n`;
out += "| File | Last shipped |\n";
out += "|------|--------------|\n";
for (const c of components) {
  out += `| [${c.file}](../${c.file}) | ${shortDate(c.shipped)} |\n`;
}
out += "\n";

const wikiDir = path.join(process.cwd(), "wiki");
mkdirSync(wikiDir, { recursive: true });
writeFileSync(path.join(wikiDir, "state.md"), out);

console.log(
  `[wiki-state] wrote wiki/state.md — ${routes.length} routes, ${endpoints.length} endpoints, ${components.length} components`,
);
