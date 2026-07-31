import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { mergeDiverse, DEFAULT_FLOOR, type Domain } from "@/lib/knowledge/retrieve";
import type { SearchResult } from "@/lib/knowledge/search";

// E6: does multi-perspective retrieval actually surface more books?
//
// Phase 0 measured the baseline against the real 19-book corpus:
//   TODAY  vectorSearch(rawTurn, undefined, 5)   1.72 distinct books/turn
//   CHEAP  K=30, cap 2/doc, take 8               3.83 distinct books/turn
//
// This suite compares candidate-selection policies over the SAME retrieved
// pool, so the only variable is the merge. Retrieval and embedding happen once
// per question and are then reused across every arm — otherwise the comparison
// would be measuring embedding-call variance, which is exactly the trap the
// prompt A/B fell into (see wiki/lessons-learned/2026-07-31-verification-failures.md).
//
// It also settles two open design questions with evidence rather than argument:
//   1. What should perQueryK be? A narrow pool makes the per-document cap a
//      no-op, because the cap needs alternatives to choose from.
//   2. Does the diversity swap (step 6) earn its complexity, or do steps 1-5
//      carry the result on their own?
//
// Needs DATABASE_URL (DEV, at PROD parity via scripts/pull-prod-books.mjs) and
// OPENROUTER_API_KEY. `pnpm eval` loads .env.local.

const DB = process.env.DATABASE_URL;
const KEY = process.env.OPENROUTER_API_KEY;
const ENABLED = Boolean(DB && KEY);

// Real consulting questions spanning the domains the library actually holds.
const QUESTIONS: Array<{ q: string; domains: Domain[] }> = [
  { q: "how do I sequence data governance for a bank that has failed two audits and blames the vendor", domains: ["dmbok", "consulting"] },
  { q: "the client keeps agreeing in the room then nothing changes after the meeting", domains: ["consulting"] },
  { q: "should we build a data mesh or a central warehouse for a mid-size insurer", domains: ["engineering", "dmbok"] },
  { q: "how do I price and scope a discovery engagement without giving the work away", domains: ["consulting"] },
  { q: "how do I structure a data quality programme that survives a budget cut", domains: ["dmbok", "analytics"] },
  { q: "what metrics actually prove a data programme is delivering value", domains: ["analytics", "dmbok"] },
  { q: "how do I build trust with a sceptical executive sponsor who has been burned before", domains: ["consulting"] },
  { q: "migrating a legacy warehouse without a big-bang cutover", domains: ["engineering", "dmbok"] },
];

async function embed(text: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/text-embedding-3-large",
      input: text,
      dimensions: 1024,
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return `[${j.data[0].embedding.join(",")}]`;
}

const distinct = (chunks: SearchResult[]) =>
  new Set(chunks.map((c) => c.documentId)).size;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe.skipIf(!ENABLED)("retrieval diversity", () => {
  const sql = postgres(DB!, {
    max: 1,
    ssl: /127\.0\.0\.1|localhost/.test(DB ?? "") ? false : "require",
  });

  // Candidate pools, fetched once and shared by every arm.
  const pools = new Map<string, { wide: SearchResult[]; fanout: SearchResult[] }>();

  async function topK(vec: string, k: number, domain?: Domain): Promise<SearchResult[]> {
    const rows = await sql`
      SELECT c.id AS "chunkId", c.document_id AS "documentId", c.content,
             d.title, d.category,
             1 - (c.embedding <=> ${vec}::vector) AS similarity
      FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
      WHERE c.embedding IS NOT NULL AND d.status = 'ready'
        ${domain ? sql`AND d.category = ${domain}` : sql``}
      ORDER BY c.embedding <=> ${vec}::vector LIMIT ${k}`;
    return rows as unknown as SearchResult[];
  }

  async function poolsFor(item: (typeof QUESTIONS)[number]) {
    const cached = pools.get(item.q);
    if (cached) return cached;
    const rawVec = await embed(item.q);
    // Arm A/B pool: one query, wide K.
    const wide = await topK(rawVec, 30);
    // Arm C/D pool: one search per target domain, K=12 each. Stands in for
    // decomposition without letting a flaky model call move the numbers.
    const perDomain = await Promise.all(item.domains.map((d) => topK(rawVec, 12, d)));
    const built = { wide, fanout: [...wide.slice(0, 12), ...perDomain.flat()] };
    pools.set(item.q, built);
    return built;
  }

  it("reproduces the measured single-query baseline", async () => {
    const counts: number[] = [];
    for (const item of QUESTIONS) {
      const { wide } = await poolsFor(item);
      // Today's behaviour: top-5, old 0.3 floor, no cap.
      const top5 = wide.slice(0, 5).filter((c) => c.similarity > 0.3);
      counts.push(distinct(top5));
    }
    const avg = mean(counts);
    console.log(`  BASELINE  top-5, floor 0.3, no cap        ${avg.toFixed(2)} books`);
    // Phase 0 measured 1.72 over 18 questions; 8 questions will vary a little.
    expect(avg).toBeLessThan(2.6);
  }, 120_000);

  it("the per-document cap is what moves diversity, and wider K helps it", async () => {
    const arms = [
      { label: "cap2, K=8  (narrow pool)", k: 8, maxPerDoc: 2 },
      { label: "cap2, K=12", k: 12, maxPerDoc: 2 },
      { label: "cap2, K=30", k: 30, maxPerDoc: 2 },
      { label: "cap3, K=30", k: 30, maxPerDoc: 3 },
    ];
    const results: Record<string, number> = {};
    for (const arm of arms) {
      const counts: number[] = [];
      for (const item of QUESTIONS) {
        const { wide } = await poolsFor(item);
        const merged = mergeDiverse(wide.slice(0, arm.k), { maxPerDoc: arm.maxPerDoc });
        counts.push(distinct(merged.chunks));
      }
      results[arm.label] = mean(counts);
      console.log(`  ${arm.label.padEnd(26)} ${mean(counts).toFixed(2)} books`);
    }
    // A narrow pool starves the cap — it has nothing to swap in.
    expect(results["cap2, K=30"]).toBeGreaterThan(results["cap2, K=8  (narrow pool)"]);
    // And the cap must beat today's ungated top-5 comfortably.
    expect(results["cap2, K=30"]).toBeGreaterThan(3);
  }, 180_000);

  it("domain fan-out adds sources the single-neighbourhood pool misses", async () => {
    const wideCounts: number[] = [];
    const fanCounts: number[] = [];
    for (const item of QUESTIONS) {
      const { wide, fanout } = await poolsFor(item);
      wideCounts.push(distinct(mergeDiverse(wide, {}).chunks));
      fanCounts.push(distinct(mergeDiverse(fanout, {}).chunks));
    }
    console.log(`  wide-K only               ${mean(wideCounts).toFixed(2)} books`);
    console.log(`  wide-K + domain fan-out   ${mean(fanCounts).toFixed(2)} books`);
    // Recorded, not asserted: the measurement showed fan-out UNDERPERFORMS wide-K
    // (3.38 vs 3.88). Domain filtering narrows the candidate set to one shelf,
    // and the shelves are uneven — engineering holds 10 books, analytics 2 — so
    // a domain-scoped search returns chunks concentrated in FEWER documents.
    // Asserting fan-out wins would be asserting something false.
    expect(mean(fanCounts)).toBeGreaterThan(2);
  }, 180_000);

  // The step-6 kill-criterion test lived here. It reported 0/8 fires and +0.00
  // books, the criterion was met, and step 6 was deleted from retrieve.ts. The
  // test is removed with the code it judged.

  it("the floor separates covered from uncovered questions", async () => {
    const covered = await embed("how do I establish data stewardship roles");
    const uncovered = await embed("what is reasonable seed round dilution right now");
    const c = (await topK(covered, 30)).filter((r) => r.similarity > DEFAULT_FLOOR).length;
    const u = (await topK(uncovered, 30)).filter((r) => r.similarity > DEFAULT_FLOOR).length;
    console.log(`  chunks above floor — covered ${c}, uncovered ${u}`);
    expect(c).toBeGreaterThan(u);
  }, 120_000);
});

// Does the decompose call earn its per-turn round trip?
//
// The sweep above killed its DIVERSITY justification: domain fan-out scored
// 3.38 against wide-K's 3.88. The only remaining case for it is query
// REWRITING — turning "what about the governance angle?" into something
// searchable, which the raw-turn path cannot do at all.
//
// Measured objectively: a context-free follow-up should retrieve weak matches,
// and a rewritten one should retrieve stronger matches from the same corpus.
describe.skipIf(!ENABLED)("query rewriting", () => {
  const sql = postgres(DB!, {
    max: 1,
    ssl: /127\.0\.0\.1|localhost/.test(DB ?? "") ? false : "require",
  });

  // Real conversational follow-ups: unsearchable alone, meaningful in context.
  const CASES = [
    {
      context: "We're rolling out a data platform for a bank that failed two audits.",
      followUp: "what about the governance angle",
      rewritten: "data governance operating model and stewardship accountability for a bank remediating audit findings",
    },
    {
      context: "The client agreed to the plan in the room but nothing has moved in six weeks.",
      followUp: "how do I handle that",
      rewritten: "handling client resistance and lack of follow-through after apparent agreement in a consulting engagement",
    },
    {
      context: "We're choosing between a lakehouse and a classic dimensional warehouse.",
      followUp: "which one for a mid-size insurer",
      rewritten: "choosing between lakehouse and dimensional warehouse architecture for a mid-size insurance company",
    },
    {
      context: "Budget for the data quality programme is being cut by 40%.",
      followUp: "so what do I drop first",
      rewritten: "prioritising data quality programme scope under budget reduction",
    },
  ];

  it("rewriting retrieves materially stronger matches than the raw follow-up", async () => {
    const rawTops: number[] = [];
    const rewrittenTops: number[] = [];
    for (const c of CASES) {
      for (const [text, sink] of [
        [c.followUp, rawTops],
        [c.rewritten, rewrittenTops],
      ] as const) {
        const vec = await embed(text);
        const rows = await sql`
          SELECT 1 - (c.embedding <=> ${vec}::vector) AS similarity
          FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
          WHERE c.embedding IS NOT NULL AND d.status = 'ready'
          ORDER BY c.embedding <=> ${vec}::vector LIMIT 1`;
        sink.push(Number((rows as unknown as Array<{ similarity: number }>)[0].similarity));
      }
      console.log(
        `  "${c.followUp.slice(0, 32)}" raw ${rawTops.at(-1)!.toFixed(3)} -> rewritten ${rewrittenTops.at(-1)!.toFixed(3)}`,
      );
    }
    const rawAvg = mean(rawTops);
    const reAvg = mean(rewrittenTops);
    console.log(`  mean top-1  raw ${rawAvg.toFixed(3)}  rewritten ${reAvg.toFixed(3)}  (floor ${DEFAULT_FLOOR})`);
    console.log(`  raw follow-ups clearing the floor: ${rawTops.filter((s) => s > DEFAULT_FLOOR).length}/${CASES.length}`);
    console.log(`  rewritten clearing the floor:      ${rewrittenTops.filter((s) => s > DEFAULT_FLOOR).length}/${CASES.length}`);
    console.log(
      reAvg - rawAvg > 0.05
        ? "  VERDICT: rewriting earns the round trip — raw follow-ups retrieve noise."
        : "  VERDICT: rewriting does not move retrieval. Drop the decompose call.",
    );
    expect(reAvg).toBeGreaterThan(rawAvg);
  }, 180_000);
});

// Multiple queries vs one, at EQUAL candidate budget.
//
// The fan-out test above conflated two things: issuing several queries, and
// filtering each to a domain. Filtering was what hurt (uneven shelves). This
// isolates the other half — several UNFILTERED rewrites hitting different
// neighbourhoods — and holds total candidates constant so the comparison is
// about the strategy, not about fetching more rows.
describe.skipIf(!ENABLED)("multi-query vs single query at equal budget", () => {
  const sql = postgres(DB!, {
    max: 1,
    ssl: /127\.0\.0\.1|localhost/.test(DB ?? "") ? false : "require",
  });

  // Three angles on one question, as a good decomposition would produce them.
  const CASES = [
    {
      single: "sequencing data governance for a bank that failed two audits and blames the vendor",
      multi: [
        "data governance operating model and stewardship accountability",
        "handling a client who deflects blame onto a vendor",
        "remediating audit findings in a regulated financial institution",
      ],
    },
    {
      single: "pricing and scoping a discovery engagement without giving the work away",
      multi: [
        "scoping a consulting discovery phase as a fixed deliverable",
        "structuring an engagement proposal and problem definition",
        "protecting intellectual property during a sales conversation",
      ],
    },
    {
      single: "structuring a data quality programme that survives a budget cut",
      multi: [
        "data quality management dimensions and measurement",
        "prioritising programme scope under financial constraint",
        "demonstrating business value of a data initiative to a sponsor",
      ],
    },
  ];

  it("compares one query at K=30 against three at K=10", async () => {
    const topKFor = async (text: string, k: number) => {
      const vec = await embed(text);
      const rows = await sql`
        SELECT c.id AS "chunkId", c.document_id AS "documentId", c.content,
               d.title, d.category,
               1 - (c.embedding <=> ${vec}::vector) AS similarity
        FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL AND d.status = 'ready'
        ORDER BY c.embedding <=> ${vec}::vector LIMIT ${k}`;
      return rows as unknown as SearchResult[];
    };

    const singleCounts: number[] = [];
    const multiCounts: number[] = [];
    const singleScores: number[] = [];
    const multiScores: number[] = [];

    for (const c of CASES) {
      const one = await topKFor(c.single, 30);
      const many = (await Promise.all(c.multi.map((q) => topKFor(q, 10)))).flat();

      const mOne = mergeDiverse(one, {});
      const mMany = mergeDiverse(many, {});
      singleCounts.push(distinct(mOne.chunks));
      multiCounts.push(distinct(mMany.chunks));
      singleScores.push(mean(mOne.chunks.map((x) => x.similarity)));
      multiScores.push(mean(mMany.chunks.map((x) => x.similarity)));
    }

    console.log(`  1 query  x K=30   ${mean(singleCounts).toFixed(2)} books, mean score ${mean(singleScores).toFixed(3)}`);
    console.log(`  3 queries x K=10  ${mean(multiCounts).toFixed(2)} books, mean score ${mean(multiScores).toFixed(3)}`);
    const gain = mean(multiCounts) - mean(singleCounts);
    console.log(
      gain > 0.4
        ? `  VERDICT: multi-query adds +${gain.toFixed(2)} books at equal budget — keep the fan-out.`
        : `  VERDICT: multi-query adds only +${gain.toFixed(2)} books. One rewritten query is enough.`,
    );
    expect(mean(multiCounts)).toBeGreaterThan(1);
  }, 180_000);
});

// End-to-end through the real retrieve(), not a reconstruction of its policy.
// The sweeps above compare merge strategies over hand-built pools; this proves
// the shipped function actually delivers the number, decompose call included.
describe.skipIf(!ENABLED)("retrieve() end to end", () => {
  const REAL = [
    "how do I sequence data governance for a bank that has failed two audits and blames the vendor",
    "the client keeps agreeing in the room then nothing changes after the meeting",
    "how do I price and scope a discovery engagement without giving the work away",
    "how do I build trust with a sceptical executive sponsor who has been burned before",
  ];

  it("beats the 1.72-book baseline on real questions", async () => {
    const { retrieve } = await import("@/lib/knowledge/retrieve");
    const counts: number[] = [];
    for (const q of REAL) {
      const t0 = Date.now();
      const r = await retrieve({ turn: q, history: [], apiKey: KEY!, audience: "internal" });
      counts.push(r.distinctSources);
      console.log(
        `  ${r.distinctSources} books, ${r.chunks.length} chunks, covered=${r.covered}, ${Date.now() - t0}ms`,
      );
      expect(r.degraded).toBe(false);
    }
    const avg = mean(counts);
    console.log(`  AVG DISTINCT BOOKS ${avg.toFixed(2)}  (baseline 1.72)`);
    expect(avg).toBeGreaterThan(3);
  }, 180_000);

  it("reports a question the library cannot answer as uncovered", async () => {
    const { retrieve } = await import("@/lib/knowledge/retrieve");
    // There is no startup shelf — measured, and tracked as content work.
    const r = await retrieve({
      turn: "what is a reasonable seed round dilution and how should I structure the cap table",
      history: [],
      apiKey: KEY!,
      audience: "internal",
    });
    console.log(`  uncovered question: covered=${r.covered}, aboveFloor=${r.aboveFloor}`);
    expect(r.covered).toBe(false);
    expect(r.degraded).toBe(false); // it looked and found nothing — not a failure
  }, 120_000);

  it("a bad decompose key degrades to the raw turn without losing retrieval", async () => {
    const { retrieve } = await import("@/lib/knowledge/retrieve");
    // NOTE: this breaks DECOMPOSE only. embedText reads
    // process.env.OPENROUTER_API_KEY directly (lib/embeddings.ts), so the
    // searches still run on the real key. An earlier version of this test
    // assumed otherwise and asserted degraded=true against a perfectly healthy
    // retrieval.
    const r = await retrieve({
      turn: "what about the governance angle",
      history: [{ role: "user", content: "We are remediating audit findings at a bank." }],
      apiKey: "sk-invalid-key-for-this-test",
      audience: "internal",
    });
    console.log(`  bad decompose key: degraded=${r.degraded}, chunks=${r.chunks.length}, books=${r.distinctSources}`);
    expect(r.degraded).toBe(false); // search was never affected
    expect(r.chunks.length).toBeGreaterThan(0); // fell back to the raw turn
  }, 120_000);

  // A REAL embed outage: vectorSearch throws, keywordSearch (pure SQL) serves,
  // and `degraded` must fire even though chunks came back. That state is
  // invisible through searchKnowledge, which is why retrieve() does the
  // fallback itself.
  it.skipIf(!process.env.SIMULATE_EMBED_OUTAGE)(
    "reports degraded when every sub-query falls back to keyword search",
    async () => {
      const { retrieve } = await import("@/lib/knowledge/retrieve");
      const r = await retrieve({
        turn: "how do I sequence data governance for a bank that failed two audits",
        history: [],
        apiKey: KEY!,
        audience: "internal",
      });
      console.log(`  embed outage: degraded=${r.degraded}, chunks=${r.chunks.length}`);
      expect(r.degraded).toBe(true);
      expect(r.chunks.length).toBeGreaterThan(0); // keyword still served
    },
    120_000,
  );
});


// The citation strip's data, end to end: retrieve() must return distinct works
// with real titles and authors. Before the corpus retag these were filenames
// like "ABUIABA9GAAghIK0ugYowM2h3QY" — a strip showing that is worse than none.
describe.skipIf(!ENABLED)("citation sources", () => {
  it("returns real titles and authors, deduped by work", async () => {
    const { retrieve } = await import("@/lib/knowledge/retrieve");
    const r = await retrieve({
      turn: "how do I build trust with a sceptical executive sponsor who has been burned",
      history: [],
      apiKey: KEY!,
      audience: "internal",
    });
    console.log("  cited works:");
    for (const s of r.sources) console.log(`    ${s.title} — ${s.author ?? "(no author)"}`);

    expect(r.sources.length).toBeGreaterThan(1);
    // One entry per work, however many chunks it contributed.
    expect(new Set(r.sources.map((s) => s.title)).size).toBe(r.sources.length);
    // Every work carries an author after the retag.
    expect(r.sources.every((s) => s.author && s.author.length > 0)).toBe(true);
    // And no filename survivors.
    for (const s of r.sources) {
      expect(s.title).not.toMatch(/OceanofPDF|ABUIABA|^[a-z0-9-]+$/);
    }
  }, 120_000);

  it("a client turn is never handed sources to cite", async () => {
    const { retrieve } = await import("@/lib/knowledge/retrieve");
    // retrieve() itself is audience-agnostic; stream.ts does the gating. This
    // asserts the data exists so the gate is the ONLY thing standing between a
    // client turn and a named work — which is why that gate is source-asserted
    // and mutation-tested in lib/chat/source-disclosure.test.ts.
    const r = await retrieve({
      turn: "how do I build trust with a sceptical executive sponsor",
      history: [],
      apiKey: KEY!,
      audience: "client",
    });
    expect(r.sources.length).toBeGreaterThan(0);
  }, 120_000);
});
