// Release 1 gate report for ONE news-radar rubric version: labelled items, keep
// rate, valid days, and the Kept titles for the "would I write this" check. It
// refuses to run without an explicit version, so it can never blend two cohorts.
//
// Usage:
//   node --env-file=.env.local --no-warnings --conditions=react-server --import tsx \
//     scripts/radar-gate-report.mjs --version <n>
//
// Read-only. Loads TypeScript through tsx and pulls the same decide.ts rules the
// Radar page uses (lib/news-radar/gate-report.ts).

const args = process.argv.slice(2);
const i = args.indexOf("--version");
const version = i === -1 ? NaN : Number(args[i + 1]);

if (!Number.isInteger(version) || version < 1) {
  console.error("An explicit rubric version is required: --version <n>.");
  console.error("The gate counts one cohort at a time; list versions with:");
  console.error("  select version, created_at from news_radar_rubric order by version;");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set.");
  process.exit(1);
}

const host = process.env.DATABASE_URL.replace(/^.*@/, "").replace(/\/.*$/, "");
console.log(`Database host: ${host}\n`);

try {
  const { getDb } = await import("../lib/db/index.ts");
  const { loadCohortSnapshot } = await import("../lib/news-radar/queries.ts");
  const { buildGateReport } = await import("../lib/news-radar/gate-report.ts");
  const snapshot = await loadCohortSnapshot(getDb(), version);
  console.log(buildGateReport(snapshot, new Date()).text);
  process.exit(0);
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.name : "error"}`);
  process.exit(1);
}
