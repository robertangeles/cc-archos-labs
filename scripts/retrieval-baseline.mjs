// Metis Live RAG — Phase 0 baseline + similarity-floor calibration.
//
// Answers two questions that the plan's whole sequencing depends on, and that
// nobody had measured before 2026-07-31:
//
//   1. How many DISTINCT BOOKS does a turn actually see today? The chat path
//      (lib/chat/stream.ts:72) runs vectorSearch(rawTurn, undefined, 5) with no
//      per-document cap, so five chunks of one book is a normal outcome. This
//      script records that number so "retrieval got more holistic" is a
//      measured delta rather than a claim.
//
//   2. Where should the similarity FLOOR sit? stream.ts:75 filters sim > 0.3.
//      Measured against PROD, 25/25 chunks cleared 0.3 — the floor never fires,
//      so the "no book covers this" branch is unreachable and Metis grounds
//      startup questions in DMBOK chunks. Calibrating needs scores from
//      questions the library CANNOT answer, not just ones it can. Hence the two
//      question sets below.
//
// Also prints the CANDIDATE arm (wide-K + per-document cap) so the cheap fix is
// measured next to today's behaviour on the same embeddings, in one run.
//
// Usage (DEV):  node --env-file=.env.local scripts/retrieval-baseline.mjs
// Usage (PROD): DATABASE_URL="<prod>" OPENROUTER_API_KEY="<key>" node scripts/retrieval-baseline.mjs
//
// Read-only: SELECTs and embedding calls only. Never writes to the database.
// Writes one JSON artifact so later runs can diff against this baseline.
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

// Must match lib/embeddings.ts — a different model or dimension count here
// would make every number below meaningless.
const EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? "openai/text-embedding-3-large";
const EMBED_DIMS = 1024;

// Today's constants, from lib/chat/stream.ts:72-75.
const TODAY_K = 5;
const TODAY_FLOOR = 0.3;

// Candidate arm: wide retrieve, cap per document, keep the best N.
const WIDE_K = 30;
const CAP_PER_DOC = 2;
const FINAL_K = 8;

// Questions the 19-book PROD library SHOULD answer — consulting, data
// management, engineering, analytics. Q4 is deliberately a short context-free
// follow-up: it is the case query rewriting exists to fix.
const ANSWERABLE = [
  "how do I sequence data governance for a bank that has failed two audits and blames the vendor",
  "the client keeps agreeing in the room then nothing changes after the meeting",
  "should we build a data mesh or a central warehouse for a mid-size insurer",
  "what about the governance angle",
  "how do I price and scope a discovery engagement without giving the work away",
  "how do I structure a data quality programme that survives a budget cut",
  "establishing data stewardship roles and real accountability",
  "building trust with a sceptical executive sponsor who has been burned before",
  "slowly changing dimensions in a conformed dimensional model",
  "how do I frame a recommendation the client is going to resist",
  "master data management for an organisation running three different CRMs",
  "designing an idempotent data pipeline that survives replays and backfills",
  "structuring a hypothesis-driven problem breakdown for a client engagement",
  "what metrics actually prove a data programme is delivering value",
  "migrating a legacy warehouse without a big-bang cutover",
  "data lineage and impact analysis for regulatory reporting",
  "how do I say no to a client without damaging the relationship",
  "the difference between data architecture and enterprise architecture",
];

// Questions the library has NO books for — startup/founder topics. PROD has
// zero startup titles (verified 2026-07-31). Their scores are the noise floor:
// whatever these hit is what "irrelevant" looks like numerically.
const UNANSWERABLE = [
  "when should a founder kill a product bet that is not working",
  "how do I structure an early-stage cap table with two cofounders",
  "what is reasonable seed round dilution right now",
  "how do I hire my first sales rep before product market fit",
  "should I raise a bridge round or cut burn to extend runway",
  "how do I run a founder-led sales motion at seed stage",
  "what does a good startup board meeting agenda look like",
  "how do I choose between a freemium and a sales-led go-to-market",
];

async function embed(text) {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://archoslabs.xyz",
      "X-Title": "Archos Labs",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      dimensions: EMBED_DIMS,
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("embeddings response missing embedding array");
  return `[${vec.join(",")}]`;
}

// Mirrors lib/knowledge/search.ts:vectorSearch — same JOIN, same ordering, same
// HNSW index. Only K differs between the two arms.
function topK(vec, k) {
  return sql`
    SELECT d.title, d.category, 1 - (c.embedding <=> ${vec}::vector) AS sim
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL AND d.status = 'ready'
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${k}`;
}

// The candidate merge: floor, then greedy fill capping each document, which is
// step 5 of the plan's specified merge. Step 6 (the diversity swap) is
// deliberately NOT implemented here — its value is exactly what this baseline
// exists to test, so building it in would beg the question.
function capPerDoc(rows, floor) {
  const seen = new Map();
  const picked = [];
  for (const r of rows) {
    if (r.sim <= floor) continue;
    const n = seen.get(r.title) ?? 0;
    if (n >= CAP_PER_DOC) continue;
    seen.set(r.title, n + 1);
    picked.push(r);
    if (picked.length >= FINAL_K) break;
  }
  return picked;
}

const pct = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

async function measure(questions, label) {
  const rowsOut = [];
  for (const q of questions) {
    const vec = await embed(q);
    const wide = await topK(vec, WIDE_K);

    const today = wide.slice(0, TODAY_K).filter((r) => r.sim > TODAY_FLOOR);
    const cand = capPerDoc(wide, TODAY_FLOOR);

    rowsOut.push({
      question: q,
      topScore: wide[0]?.sim ?? 0,
      allScores: wide.map((r) => r.sim),
      today: { chunks: today.length, books: new Set(today.map((r) => r.title)).size },
      candidate: { chunks: cand.length, books: new Set(cand.map((r) => r.title)).size },
      todayTitles: [...new Set(today.map((r) => r.title))],
      candidateTitles: [...new Set(cand.map((r) => r.title))],
    });
    process.stdout.write(".");
  }
  process.stdout.write(` ${label} done\n`);
  return rowsOut;
}

console.log(`Corpus: ${isLocal ? "DEV (local)" : "PROD (remote)"}`);
const [{ docs, chunks }] = await sql`
  SELECT (SELECT count(*)::int FROM knowledge_document WHERE status='ready') AS docs,
         (SELECT count(*)::int FROM knowledge_chunk WHERE embedding IS NOT NULL) AS chunks`;
console.log(`${docs} ready documents, ${chunks} embedded chunks\n`);

const ans = await measure(ANSWERABLE, `${ANSWERABLE.length} answerable`);
const unans = await measure(UNANSWERABLE, `${UNANSWERABLE.length} unanswerable`);

console.log("\n" + "=".repeat(72));
console.log("DIVERSITY — distinct books per turn");
console.log("=".repeat(72));
const todayBooks = ans.map((r) => r.today.books);
const candBooks = ans.map((r) => r.candidate.books);
console.log(`  TODAY      K=${TODAY_K}, no cap          avg ${mean(todayBooks).toFixed(2)} books   (min ${Math.min(...todayBooks)}, max ${Math.max(...todayBooks)})`);
console.log(`  CANDIDATE  K=${WIDE_K}, cap ${CAP_PER_DOC}/doc, take ${FINAL_K}  avg ${mean(candBooks).toFixed(2)} books   (min ${Math.min(...candBooks)}, max ${Math.max(...candBooks)})`);
const oneBook = todayBooks.filter((n) => n <= 1).length;
console.log(`  Single-book turns today: ${oneBook}/${ans.length}`);

console.log("\n" + "=".repeat(72));
console.log("FLOOR CALIBRATION — answerable vs unanswerable score distributions");
console.log("=".repeat(72));
const ansTop = ans.map((r) => r.topScore);
const unansTop = unans.map((r) => r.topScore);
console.log("  ANSWERABLE   top-1 scores:");
console.log(`    min ${Math.min(...ansTop).toFixed(3)}  p10 ${pct(ansTop, 10).toFixed(3)}  median ${pct(ansTop, 50).toFixed(3)}  max ${Math.max(...ansTop).toFixed(3)}`);
console.log("  UNANSWERABLE top-1 scores:");
console.log(`    min ${Math.min(...unansTop).toFixed(3)}  median ${pct(unansTop, 50).toFixed(3)}  p90 ${pct(unansTop, 90).toFixed(3)}  max ${Math.max(...unansTop).toFixed(3)}`);

const gap = Math.min(...ansTop) - Math.max(...unansTop);
console.log(`\n  Separation on TOP-1 score: ${gap.toFixed(3)}`);
console.log(`  (current floor ${TODAY_FLOOR} sits below every observed score — it never fires)`);

// Top-1 alone is a fragile discriminator: one lucky chunk decides the verdict,
// and the observed margin is thin. DEPTH separates far more robustly — a
// question the library really covers has MANY chunks above a threshold, while
// an uncovered one has a couple of near-misses and nothing behind them. This
// sweep finds the threshold where the two counts separate with the widest
// margin, which is what the E8a gap signal should key off.
console.log("\n  DEPTH discriminator — how many of the top-30 clear each threshold:");
console.log("    thresh | answerable min/med/max | unanswerable min/med/max | margin");
const countAbove = (r, t) => r.allScores.filter((s) => s > t).length;
let best = null;
for (const t of [0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5]) {
  const A = ans.map((r) => countAbove(r, t));
  const U = unans.map((r) => countAbove(r, t));
  const margin = Math.min(...A) - Math.max(...U);
  console.log(
    `    ${t.toFixed(2)}   |   ${String(Math.min(...A)).padStart(2)} / ${String(pct(A, 50)).padStart(2)} / ${String(Math.max(...A)).padStart(2)}            |   ${String(Math.min(...U)).padStart(2)} / ${String(pct(U, 50)).padStart(2)} / ${String(Math.max(...U)).padStart(2)}             | ${margin > 0 ? `+${margin} chunks` : "OVERLAP"}`,
  );
  // A threshold where EVERY answerable question returns the full WIDE_K is
  // censored, not separated — the true count is above the window and we cannot
  // see it. Its margin is an artifact of where we truncated, and the gate it
  // implies would break the moment WIDE_K changed. Only trust thresholds that
  // discriminate strictly inside the window.
  const censored = Math.min(...A) >= WIDE_K;
  if (censored) console.log("           ^ censored: answerable saturates the K=" + WIDE_K + " window — margin not real");
  if (margin > 0 && !censored && (!best || margin > best.margin)) {
    best = { threshold: t, margin, ansMin: Math.min(...A), unansMax: Math.max(...U) };
  }
}
if (best) {
  const gate = Math.round((best.ansMin + best.unansMax) / 2);
  best.gate = gate;
  console.log(`\n  ==> FLOOR ${best.threshold} with a DEPTH GATE of ${gate} chunks (uncensored).`);
  console.log(`      Covered questions clear it with >=${best.ansMin} chunks; uncovered peak at ${best.unansMax}.`);
  console.log(`      Margin ${best.margin} chunks — more robust than the ${gap.toFixed(3)} top-1 margin,`);
  console.log(`      and measured strictly inside the K=${WIDE_K} window rather than against its edge.`);
  console.log(`      E8a fires the gap signal when fewer than ${gate} chunks clear ${best.threshold}.`);
} else {
  console.log("\n  ==> No uncensored threshold separates on depth. Re-run with a larger WIDE_K.");
}

console.log("\n  Unanswerable questions and what they wrongly matched:");
for (const r of unans) {
  console.log(`    ${r.topScore.toFixed(3)}  "${r.question.slice(0, 46)}" -> ${r.todayTitles[0]?.slice(0, 40) ?? "(none)"}`);
}

const out = {
  measuredAt: new Date().toISOString(),
  corpus: { docs, chunks, target: isLocal ? "dev" : "prod" },
  config: { EMBED_MODEL, EMBED_DIMS, TODAY_K, TODAY_FLOOR, WIDE_K, CAP_PER_DOC, FINAL_K },
  diversity: {
    todayAvgBooks: +mean(todayBooks).toFixed(3),
    candidateAvgBooks: +mean(candBooks).toFixed(3),
    singleBookTurnsToday: oneBook,
    total: ans.length,
  },
  floor: {
    answerableTop1: { min: Math.min(...ansTop), median: pct(ansTop, 50), max: Math.max(...ansTop) },
    unanswerableTop1: { min: Math.min(...unansTop), median: pct(unansTop, 50), max: Math.max(...unansTop) },
    top1Separation: +gap.toFixed(4),
    recommended: best,
  },
  answerable: ans,
  unanswerable: unans,
};
const path = `retrieval-baseline-${isLocal ? "dev" : "prod"}.json`;
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\nBaseline written to ${path}`);

await sql.end();
