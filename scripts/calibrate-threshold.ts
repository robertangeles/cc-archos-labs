// Cosine-distance threshold calibration for findSimilarPosts.
//
// Usage:
//   pnpm calibrate:threshold
//
// Loads .env.local for DATABASE_URL + OPENROUTER_API_KEY via Node 22's
// --env-file-if-exists. Runs a
// representative set of query texts through findSimilarPosts with
// NO threshold (i.e. always top-N), prints the distance histogram,
// and prints a recommended threshold based on the gap between
// "obvious good matches" and the long tail.
//
// SIMILARITY_THRESHOLD in lib/diagnostic/recommend.ts is initially
// set to 0.6 as a reasonable starting point. Run this script after
// migration 0017 lands in prod (so the column exists and the feature
// is live) and against the actual 253-post corpus — bump the constant
// if the data suggests a different cutoff at the elbow of YOUR
// distribution.
//
// What "obvious good" looks like:
//   - distances ≤ 0.35 → semantically very close (the post directly
//     addresses the query's topic)
//   - 0.35–0.55       → relevant but broader; still worth showing
//   - 0.55–0.70       → tenuous; would erode CFO trust at scale
//   - > 0.70          → unrelated
//
// Pick the threshold at the elbow of YOUR distribution, not the
// industry-average numbers above.

import { findSimilarPosts } from "../lib/posts/find-similar";

// Representative queries spanning the diagnostic surface. Add more
// here if the histogram from a representative set looks bimodal or
// you suspect a specific cluster is under- or over-represented in
// the blog.
const CALIBRATION_QUERIES: Array<{ label: string; queryText: { title: string; excerpt?: string; contentMd?: string } }> = [
  {
    label: "data_lineage",
    queryText: {
      title: "Document data lineage end-to-end",
      excerpt: "Foundational issue: undocumented data lineage across core systems.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "ai_agent_rollout",
    queryText: {
      title: "Stand up an AI agent in production",
      excerpt: "Customer-support intake; need governance + observability before rollout.",
      contentMd: "Service: AI Agent Development",
    },
  },
  {
    label: "data_architecture_redesign",
    queryText: {
      title: "Redesign the analytics warehouse for AI workloads",
      excerpt: "Existing star schema is brittle; AI queries hit hot spots.",
      contentMd: "Service: Data Architecture",
    },
  },
  {
    label: "governance_program",
    queryText: {
      title: "Establish a data governance program",
      excerpt: "Cross-functional governance across data, AI, and risk.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "change_management",
    queryText: {
      title: "Drive change management across the org",
      excerpt: "AI rollout meeting resistance from the analytics team.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  // Add more queries reflecting the breadth of diagnostic actions.
];

const TOP_N_FOR_HISTOGRAM = 10;

function makeHistogram(distances: number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    "0.00-0.15": 0,
    "0.15-0.30": 0,
    "0.30-0.45": 0,
    "0.45-0.60": 0,
    "0.60-0.75": 0,
    "0.75-0.90": 0,
    "0.90+": 0,
  };
  for (const d of distances) {
    if (d < 0.15) buckets["0.00-0.15"]++;
    else if (d < 0.3) buckets["0.15-0.30"]++;
    else if (d < 0.45) buckets["0.30-0.45"]++;
    else if (d < 0.6) buckets["0.45-0.60"]++;
    else if (d < 0.75) buckets["0.60-0.75"]++;
    else if (d < 0.9) buckets["0.75-0.90"]++;
    else buckets["0.90+"]++;
  }
  return buckets;
}

async function main() {
  console.log("=== findSimilarPosts threshold calibration ===\n");

  const allDistances: number[] = [];
  for (const c of CALIBRATION_QUERIES) {
    console.log(`Query: ${c.label}`);
    const results = await findSimilarPosts({
      queryText: c.queryText,
      limit: TOP_N_FOR_HISTOGRAM,
      visibility: "public",
    });
    for (const r of results) {
      console.log(`  ${r.distance.toFixed(3)}  ${r.slug}`);
      allDistances.push(r.distance);
    }
    console.log("");
  }

  console.log("=== Aggregate distance histogram ===");
  const hist = makeHistogram(allDistances);
  for (const [bucket, count] of Object.entries(hist)) {
    const bar = "█".repeat(count);
    console.log(`  ${bucket}  ${bar} (${count})`);
  }

  const sorted = [...allDistances].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  console.log(`\np25 = ${p25?.toFixed(3) ?? "n/a"}`);
  console.log(`p50 = ${p50?.toFixed(3) ?? "n/a"}`);
  console.log(`p75 = ${p75?.toFixed(3) ?? "n/a"}`);

  console.log(
    "\nRecommendation: set SIMILARITY_THRESHOLD just above p50 — that",
  );
  console.log(
    "rejects the bottom-half tail while keeping the upper-half matches.",
  );
  console.log(
    `\nCurrent value in lib/diagnostic/recommend.ts: 0.6\n`,
  );
}

main().catch((err) => {
  console.error("Calibration failed:", err);
  process.exit(1);
});
