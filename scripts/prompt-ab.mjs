// A/B the source-handling prompt change on ANSWER quality.
//
// Phase 0 measured retrieval (how many books reach the model). This measures
// what the model DOES with them, which is a different question and the one the
// library actually exists to answer. The plan sequenced the prompt rewrite
// first precisely so this number arrives before any retrieval machinery is
// built — if naming sources alone moves quality, the expensive fan-out work is
// worth less than it looked.
//
// Both arms see the IDENTICAL retrieved chunks for a given question. The prompt
// is the only variable. Retrieval is today's exact path (top-5, sim > 0.3,
// unlabelled by category) so this measures the prompt change in isolation, not
// the prompt change plus a retrieval change.
//
//   OLD arm — what shipped for months: the protection block inline in
//             systemPrompt, PLUS "Cite the source title when relevant".
//             Two contradictory instructions, both present.
//   NEW arm — internal audience post-split: attribution block, argue-with-the
//             -material instruction, no protection text.
//
// Usage: DATABASE_URL="<dev-or-prod>" OPENROUTER_API_KEY="<key>" \
//          node scripts/prompt-ab.mjs [--questions N] [--model <id>]
//
// Read-only against the database. Costs 2 generations + 2 judgements per
// question, so it is not free — default is 8 questions.
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!apiKey) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};
const N = Number(arg("--questions", "8"));
// The chat model lives in the encrypted integration config, which this script
// cannot read. Pass --model to match production exactly.
const CHAT_MODEL = arg("--model", "anthropic/claude-sonnet-4-6");
const JUDGE_MODEL = arg("--judge", "anthropic/claude-sonnet-4-6");

const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

import {
  ATTRIBUTION,
  NEW_RAG_INSTRUCTION,
  OLD_RAG_INSTRUCTION,
  extractProtection,
} from "./metis-source-blocks.mjs";

const QUESTIONS = [
  "How do I sequence data governance for a bank that has failed two audits and blames the vendor?",
  "The client keeps agreeing in the room and then nothing changes after the meeting. What do I do?",
  "Should we build a data mesh or a central warehouse for a mid-size insurer?",
  "How do I price and scope a discovery engagement without giving the work away?",
  "How do I structure a data quality programme that survives a budget cut?",
  "How do I frame a recommendation the client is going to resist?",
  "How do I say no to a client without damaging the relationship?",
  "What metrics actually prove a data programme is delivering value?",
  "How do I build trust with a sceptical executive sponsor who has been burned before?",
  "How do I migrate a legacy warehouse without a big-bang cutover?",
];

async function openrouter(model, messages, jsonMode = false) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://archoslabs.xyz",
      "X-Title": "Archos Labs",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const choice = j.choices?.[0];
  const content = choice?.message?.content ?? "";
  // An empty completion is not a valid result — surface WHY (refusal, length
  // cap, content filter) rather than letting it fall through as "" and become
  // an unexplained zero in the aggregate. The first run of this script scored
  // 0/8 on everything for exactly this reason.
  if (!content) {
    throw new Error(
      `empty completion (finish_reason=${choice?.finish_reason ?? "?"}, ` +
        `native=${choice?.native_finish_reason ?? "?"}, ` +
        `refusal=${JSON.stringify(choice?.message?.refusal ?? null)})`,
    );
  }
  return content;
}

// Models wrap JSON in prose or a markdown fence often enough that a bare
// JSON.parse is a coin flip. Pull the outermost object out first.
function parseJudge(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in judge output");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function embed(text) {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/text-embedding-3-large",
      input: text,
      dimensions: 1024,
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  return `[${(await res.json()).data[0].embedding.join(",")}]`;
}

const [row] = await sql`SELECT value FROM site_setting WHERE key = 'workspace_chat_prompt'`;
if (!row) { console.error("No workspace_chat_prompt row."); process.exit(1); }
const p = row.value;

// Derive both arms from whatever shape the row is in, so this runs against an
// unsplit PROD row without writing to it. A split row already has the pieces;
// an unsplit one gets them extracted in memory using the same function the
// migration uses, so the two agree by construction.
const { core, protection } = p.sourceProtection
  ? { core: p.systemPrompt, protection: p.sourceProtection }
  : extractProtection(p.systemPrompt);

if (!protection) {
  console.error("No source-protection section found and none stored. Cannot build the control arm.");
  process.exit(1);
}

// OLD arm reconstructs the pre-split assembly exactly: protection inline in the
// system prompt, plus the RAG block carrying the contradicting cite instruction.
const OLD_SYSTEM = `${core}\n\n${protection}`;
const NEW_SYSTEM = `${core}\n\n${p.sourceAttribution ?? ATTRIBUTION}`;
console.log(`Prompt row: ${p.sourceProtection ? "already split" : "unsplit — arms derived in memory, nothing written"}`);

const JUDGE = `You are scoring a consultant's answer. Return ONLY JSON:
{
  "worksNamed": [<exact strings from the supplied list that the answer explicitly names or unmistakably refers to, e.g. by author surname or book title>],
  "takesPosition": <true if it commits to a recommendation rather than listing considerations>,
  "surfacesTension": <true if it names a genuine disagreement or trade-off between two ideas AND resolves it>,
  "separatesSourceFromJudgement": <true if it distinguishes what the material says from the consultant's own view>,
  "hedging": <0-10, higher = more hedged and non-committal>
}
Judge only what is present. Do not reward length.`;

console.log(`Target: ${isLocal ? "DEV" : "PROD"} | chat=${CHAT_MODEL} | judge=${JUDGE_MODEL}`);
console.log(`${Math.min(N, QUESTIONS.length)} questions x 2 arms\n`);

const results = [];
for (const q of QUESTIONS.slice(0, N)) {
  const vec = await embed(q);
  const chunks = await sql`
    SELECT d.title, c.content, 1 - (c.embedding <=> ${vec}::vector) AS sim
    FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL AND d.status = 'ready'
    ORDER BY c.embedding <=> ${vec}::vector LIMIT 5`;
  const kept = chunks.filter((c) => c.sim > 0.3);
  const titles = [...new Set(kept.map((c) => c.title))];
  // Identical material for both arms — labelled, because both arms are
  // internal-audience assemblies. Only the instruction differs.
  const material = kept.map((c) => `[${c.title}]\n${c.content}`).join("\n\n---\n\n");

  const answers = {};
  for (const [arm, system, instruction] of [
    ["old", OLD_SYSTEM, OLD_RAG_INSTRUCTION],
    ["new", NEW_SYSTEM, NEW_RAG_INSTRUCTION],
  ]) {
    answers[arm] = await openrouter(CHAT_MODEL, [
      { role: "system", content: `${system}\n\n${instruction}\n\n${material}` },
      { role: "user", content: q },
    ]);
  }

  const scores = {};
  for (const arm of ["old", "new"]) {
    const raw = await openrouter(
      JUDGE_MODEL,
      [
        { role: "system", content: JUDGE },
        {
          role: "user",
          content: `QUESTION: ${q}\n\nWORKS AVAILABLE TO THE ANSWER:\n${titles.map((t) => `- ${t}`).join("\n")}\n\nANSWER:\n${answers[arm]}`,
        },
      ],
      true,
    );
    try {
      scores[arm] = parseJudge(raw);
    } catch (err) {
      // Keep the raw output. A silent zero is indistinguishable from a real
      // zero in the aggregate, which is how the first run produced a clean
      // 0/8 across every metric and looked like a finding.
      scores[arm] = { parseFailed: true, parseError: String(err), raw: raw.slice(0, 600) };
    }
  }

  results.push({ question: q, availableWorks: titles, scores, answers });
  const n = (a) => scores[a].worksNamed?.length ?? 0;
  console.log(`  named ${n("old")} -> ${n("new")} works | position ${scores.old.takesPosition}->${scores.new.takesPosition} | tension ${scores.old.surfacesTension}->${scores.new.surfacesTension}  "${q.slice(0, 40)}"`);
}

const failures = results.flatMap((r) => ["old","new"].filter((a) => r.scores[a].parseFailed).map((a) => `${a}: ${r.scores[a].parseError}`));
if (failures.length) { console.log(`\nJUDGE FAILURES (${failures.length}):`); for (const f of new Set(failures)) console.log("  " + f); }
const agg = (arm, key) => results.filter((r) => r.scores[arm][key]).length;
const namedAvg = (arm) =>
  results.reduce((s, r) => s + (r.scores[arm].worksNamed?.length ?? 0), 0) / results.length;
const hedgeAvg = (arm) => {
  const v = results.map((r) => r.scores[arm].hedging).filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

console.log("\n" + "=".repeat(64));
console.log(`ANSWER QUALITY — ${results.length} questions`);
console.log("=".repeat(64));
console.log(`                                  OLD      NEW`);
console.log(`  works named per answer          ${namedAvg("old").toFixed(2)}     ${namedAvg("new").toFixed(2)}`);
console.log(`  takes a position                ${agg("old", "takesPosition")}/${results.length}      ${agg("new", "takesPosition")}/${results.length}`);
console.log(`  surfaces + resolves a tension   ${agg("old", "surfacesTension")}/${results.length}      ${agg("new", "surfacesTension")}/${results.length}`);
console.log(`  separates source from judgement ${agg("old", "separatesSourceFromJudgement")}/${results.length}      ${agg("new", "separatesSourceFromJudgement")}/${results.length}`);
const ho = hedgeAvg("old"), hn = hedgeAvg("new");
console.log(`  hedging (lower better)          ${ho?.toFixed(1) ?? "n/a"}      ${hn?.toFixed(1) ?? "n/a"}`);
console.log("=".repeat(64));

const path = "prompt-ab-results.json";
writeFileSync(path, JSON.stringify({ measuredAt: new Date().toISOString(), chatModel: CHAT_MODEL, judgeModel: JUDGE_MODEL, results }, null, 2));
console.log(`\nFull answers + scores written to ${path}`);

await sql.end();
