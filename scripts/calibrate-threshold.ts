// Cosine-distance threshold calibration for findSimilarPosts.
//
// Usage:
//   pnpm calibrate:threshold
//
// Loads .env.local for DATABASE_URL + OPENROUTER_API_KEY via Node 22's
// --env-file-if-exists. Runs a representative set of diagnostic-shaped
// queries through ANN against the live post.embedding column. Prints:
//
//   - Top-N hits per query (slug + distance) — useful for filling in
//     the expectInTop3 slug placeholders in
//     tests/eval/recommend.eval.test.ts
//   - Aggregate distance histogram + p25/p50/p75 — useful for picking
//     SIMILARITY_THRESHOLD in lib/diagnostic/recommend.ts (currently 0.6)
//
// Self-contained: does NOT import from lib/. The lib/ chain pulls in
// `server-only`, which throws under tsx (no Next.js RSC context). This
// script speaks Postgres + OpenRouter directly using the same model
// IDs + dimensions as the production embedder.
//
// Embed model + dimensions kept in sync with lib/embeddings.ts:
//   - openai/text-embedding-3-large via OpenRouter
//   - 1024 dimensions (matches post.embedding vector(1024))
// If those constants change in lib/embeddings.ts, change them here too.

import postgres from "postgres";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-large";
const EMBED_DIMS = 1024;
const TOP_N_PER_QUERY = 5;
const REQUEST_TIMEOUT_MS = 30_000;

interface CalibrationQuery {
  label: string;
  queryText: {
    title: string;
    excerpt?: string;
    contentMd?: string;
  };
}

// Representative diagnostic-shaped queries spanning the three Archos
// service lines + a few cross-cutting risk patterns. Mirrors the shape
// of action_plan items (title + explanation + service-line label) the
// production pipeline embeds.
const CALIBRATION_QUERIES: CalibrationQuery[] = [
  {
    label: "data_lineage_documentation",
    queryText: {
      title: "Document data lineage end-to-end",
      excerpt:
        "Foundational issue: undocumented data lineage across core systems blocks AI initiatives.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "ai_agent_production_rollout",
    queryText: {
      title: "Stand up an AI agent in production",
      excerpt:
        "Customer-support intake agent; need governance + observability before rollout.",
      contentMd: "Service: AI Agent Development",
    },
  },
  {
    label: "data_architecture_redesign",
    queryText: {
      title: "Redesign the analytics warehouse for AI workloads",
      excerpt:
        "Existing star schema is brittle; AI queries hit hot spots and cause analyst delays.",
      contentMd: "Service: Data Architecture",
    },
  },
  {
    label: "data_governance_program",
    queryText: {
      title: "Establish a data governance program",
      excerpt:
        "Cross-functional governance across data, AI, and risk teams.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "change_management_resistance",
    queryText: {
      title: "Drive change management across the org",
      excerpt:
        "AI rollout meeting resistance from analytics team; product owners not bought in.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "model_evaluation_strategy",
    queryText: {
      title: "Build an evaluation framework for production AI",
      excerpt:
        "Need to measure model quality continuously; not just at launch.",
      contentMd: "Service: AI Agent Development",
    },
  },
  {
    label: "executive_ai_strategy",
    queryText: {
      title: "Set executive-level AI strategy and KPIs",
      excerpt:
        "CEO wants AI as a strategic differentiator; needs measurable goals.",
      contentMd: "Service: AI Readiness Assessment",
    },
  },
  {
    label: "data_quality_remediation",
    queryText: {
      title: "Address data quality issues blocking AI",
      excerpt:
        "Source data has gaps, inconsistencies; downstream models inherit them.",
      contentMd: "Service: Data Architecture",
    },
  },
];

function buildEmbeddingText(input: {
  title: string;
  excerpt?: string;
  contentMd?: string;
}): string {
  const parts = [input.title];
  if (input.excerpt) parts.push(input.excerpt);
  if (input.contentMd) parts.push(input.contentMd.slice(0, 1500));
  return parts.join("\n\n");
}

async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set in .env.local — calibration needs the same embed key as the live retrieval pipeline.",
    );
  }
  const modelId = process.env.OPENROUTER_EMBED_MODEL ?? EMBED_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        input: text,
        dimensions: EMBED_DIMS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `OpenRouter ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = json.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMS) {
      throw new Error(
        `OpenRouter returned an unexpected embedding shape (got ${embedding?.length} dims, expected ${EMBED_DIMS}).`,
      );
    }
    return embedding;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchTopN(
  sql: ReturnType<typeof postgres>,
  vector: number[],
  limit: number,
): Promise<Array<{ slug: string; title: string; distance: number }>> {
  const literal = `[${vector.join(",")}]`;
  const rows = await sql<
    Array<{ slug: string; title: string; distance: string | number }>
  >`
    SELECT slug, title, embedding <=> ${literal}::vector AS distance
    FROM post
    WHERE status = 'published'
      AND archived_at IS NULL
      AND visibility = 'listed'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    distance: typeof r.distance === "number" ? r.distance : Number(r.distance),
  }));
}

function bucketHistogram(distances: number[]): Record<string, number> {
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
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set in .env.local — calibration runs against the same DB the prod pipeline reads.",
    );
  }
  const sql = postgres(url, { max: 1, ssl: "require" });

  console.log("=== findSimilarPosts threshold calibration ===\n");
  console.log(`Model: ${EMBED_MODEL} (${EMBED_DIMS} dims)`);
  console.log(`Queries: ${CALIBRATION_QUERIES.length}, top ${TOP_N_PER_QUERY} per query\n`);

  const allDistances: number[] = [];

  for (const q of CALIBRATION_QUERIES) {
    process.stdout.write(`Query: ${q.label} ... `);
    const text = buildEmbeddingText(q.queryText);
    let vector: number[];
    try {
      vector = await embedText(text);
    } catch (err) {
      console.log(`embed failed: ${(err as Error).message}`);
      continue;
    }
    const rows = await searchTopN(sql, vector, TOP_N_PER_QUERY);
    console.log("");
    for (const r of rows) {
      console.log(`  ${r.distance.toFixed(3)}  ${r.slug}`);
      allDistances.push(r.distance);
    }
    console.log("");
  }

  console.log("=== Aggregate distance histogram (across all top-N hits) ===");
  const hist = bucketHistogram(allDistances);
  for (const [bucket, count] of Object.entries(hist)) {
    const bar = "█".repeat(count);
    console.log(`  ${bucket}  ${bar} (${count})`);
  }

  const sorted = [...allDistances].sort((a, b) => a - b);
  const pct = (p: number): number | undefined =>
    sorted[Math.floor(sorted.length * p)];
  console.log(`\np25 = ${pct(0.25)?.toFixed(3) ?? "n/a"}`);
  console.log(`p50 = ${pct(0.5)?.toFixed(3) ?? "n/a"}`);
  console.log(`p75 = ${pct(0.75)?.toFixed(3) ?? "n/a"}`);
  console.log(`p90 = ${pct(0.9)?.toFixed(3) ?? "n/a"}`);

  console.log(
    "\nCurrent SIMILARITY_THRESHOLD in lib/diagnostic/recommend.ts: 0.6\n",
  );
  console.log(
    "Guidance: set the threshold just above the elbow of YOUR distribution.",
  );
  console.log(
    "  - Distances ≤ p50 are the matches the system should accept.",
  );
  console.log(
    "  - Distances in the p50-p75 range are weak/tenuous — most should be excluded.",
  );
  console.log(
    "  - Distances > p75 are noise — definitely exclude.\n",
  );

  await sql.end();
}

main().catch((err) => {
  console.error("\nCalibration failed:", err);
  process.exit(1);
});
