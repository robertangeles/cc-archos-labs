import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { embedText } from "@/lib/embeddings";
import { sanitizeForBrain } from "./sanitize";
import {
  resolveLlmConfig,
  buildAuthHeaders,
  OPENROUTER_URL,
} from "@/lib/llm/config";

// Distillation layer: turn a chat message into clean, deduplicated atomic
// facts instead of storing the raw turn. Two LLM steps (extract, then judge)
// run in the existing fire-and-forget capture path. Everything fails OPEN or
// SOFT — a down LLM/DB never breaks chat, it just stores less.
//
//   extractFacts(userMsg) ─▶ [atomic facts]  ([] for greetings/questions)
//   consolidateAndApply()  ─▶ embed → cosine neighbors → 1 judge call →
//                             insert / skip(dup) / replace(supersede)

// Extraction model. Optional BRAIN_EXTRACTION_MODEL env var, default Haiku.
// Switch to a stronger model here if fact quality is weak.
function extractionModel(): string {
  return process.env.BRAIN_EXTRACTION_MODEL?.trim() || "anthropic/claude-haiku-4.5";
}

const LLM_TIMEOUT_MS = 15000;
const MAX_FACT_CHARS = 500; // per-fact cap
const MAX_FACTS = 12; // per turn
const MIN_MESSAGE_CHARS = 4; // below this, don't bother extracting
const MAX_INPUT_CHARS = 4000; // user message truncation before extraction
const NEIGHBOR_LIMIT = 5; // existing facts shown to the judge per candidate

const EXTRACT_SYSTEM = `You extract durable facts about the USER from a single chat message, for a long-term memory system.

Return ONLY a JSON object of the form {"facts": ["...", "..."]}. No prose, no markdown, no code fences.

Each fact is one atomic, self-contained statement about the user, written in the third person (e.g. "The user's name is Rob Angeles.", "The user prefers DMBOK for data management.").

Rules:
- Include ONLY facts the user explicitly stated or clearly implied about themselves — their identity, work, company, location, projects, preferences, goals, or context.
- NEVER invent, infer, guess, or embellish. If the user did not say it, do not record it.
- Ignore greetings, questions, requests, and small talk.
- If there is nothing durable worth remembering, return {"facts": []}.`;

const JUDGE_SYSTEM = `You are the consolidation step of a user's long-term memory. You receive NEW candidate facts and the user's EXISTING stored facts. For each candidate choose one action:
- "insert": genuinely new information not already covered by an existing fact.
- "skip": already covered by an existing fact (a duplicate or a subset).
- "replace": updates or contradicts a specific existing fact (e.g. a changed preference or a corrected detail); include that fact's id.

Return ONLY a JSON object: {"decisions": [{"candidate": 1, "action": "insert"}, {"candidate": 2, "action": "replace", "id": "<existing id>"}]}. One entry per candidate, in order. No prose.`;

// ── LLM boundary ────────────────────────────────────────────────────

// Non-streaming JSON completion. Returns the parsed value or null on any
// failure (missing key, HTTP error, timeout, unparseable body). Never throws.
async function callLlmJson(
  model: string,
  system: string,
  user: string,
  maxTokens = 800,
): Promise<unknown | null> {
  let apiKey: string;
  try {
    ({ apiKey } = await resolveLlmConfig(model));
  } catch {
    return null;
  }
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return safeJsonParse(content);
  } catch {
    return null;
  }
}

// Models sometimes wrap JSON in ```fences``` or add stray prose. Strip fences,
// then fall back to the first {...} block.
function safeJsonParse(text: string): unknown {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* try the object-substring fallback */
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* give up */
    }
  }
  return null;
}

// ── Extraction ──────────────────────────────────────────────────────

const FactsSchema = z.object({ facts: z.array(z.string()) });

/**
 * Validate + clean the extractor's output into a deduplicated fact list.
 * Lenient: a single bad element (empty, over-long) is dropped, not fatal to
 * the whole batch. Caps count. Pure.
 */
export function parseFacts(raw: unknown): string[] {
  const p = FactsSchema.safeParse(raw);
  if (!p.success) return [];
  const cleaned = p.data.facts
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.length <= MAX_FACT_CHARS);
  return [...new Set(cleaned)].slice(0, MAX_FACTS);
}

/**
 * Extract atomic user facts from the USER message only (never the assistant
 * reply — that is where confabulation comes from). Returns [] for
 * greetings/questions/small-talk or on any LLM failure.
 */
export async function extractFacts(userMessage: string): Promise<string[]> {
  const clean = sanitizeForBrain(userMessage).sanitized.trim();
  if (clean.length < MIN_MESSAGE_CHARS) return [];
  const raw = await callLlmJson(
    extractionModel(),
    EXTRACT_SYSTEM,
    `User message:\n"""${clean.slice(0, MAX_INPUT_CHARS)}"""`,
  );
  return parseFacts(raw);
}

// ── Consolidation ───────────────────────────────────────────────────

export interface Decision {
  action: "insert" | "skip" | "replace";
  replaceId?: string;
}

const DecisionsSchema = z.object({
  decisions: z.array(
    z.object({
      candidate: z.number().int().positive(),
      action: z.enum(["insert", "skip", "replace"]),
      id: z.string().optional(),
    }),
  ),
});

/**
 * Map the judge's output to one Decision per candidate. Fail-open: anything
 * unparseable or out of range defaults to "insert" (keep the fact — a later
 * turn's judge can still supersede it). Pure.
 */
export function parseDecisions(raw: unknown, n: number): Decision[] {
  const out: Decision[] = Array.from({ length: n }, () => ({ action: "insert" }));
  const p = DecisionsSchema.safeParse(raw);
  if (!p.success) return out;
  for (const d of p.data.decisions) {
    const i = d.candidate - 1;
    if (i < 0 || i >= n) continue;
    if (d.action === "replace" && d.id) out[i] = { action: "replace", replaceId: d.id };
    else if (d.action === "skip") out[i] = { action: "skip" };
    else out[i] = { action: "insert" };
  }
  return out;
}

function buildJudgeInput(facts: string[], neighbors: Map<string, string>): string {
  const cand = facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const exist = [...neighbors.entries()].map(([id, body]) => `- ${id}: ${body}`).join("\n");
  return `Candidate facts:\n${cand}\n\nExisting facts:\n${exist}`;
}

/**
 * Embed each fact, find its cosine-nearest existing active facts, run ONE
 * judge call, then apply insert/skip/replace in a single transaction. Every
 * step fails soft. Isolation: all reads/writes are scoped to userId.
 */
export async function consolidateAndApply(
  userId: string,
  facts: string[],
  conversationId: string | null,
): Promise<void> {
  // Embed candidates. A fact whose embed fails is dropped (an unretrievable
  // row would be invisible to recall anyway).
  const cands: Array<{ fact: string; vec: string }> = [];
  for (const fact of facts) {
    try {
      const emb = await embedText(fact.slice(0, MAX_FACT_CHARS));
      cands.push({ fact, vec: `[${emb.join(",")}]` });
    } catch {
      /* embed API down — skip this fact */
    }
  }
  if (cands.length === 0) return;

  const db = getDb();

  // Cosine-nearest existing active facts, deduped across candidates.
  const neighbors = new Map<string, string>();
  for (const c of cands) {
    try {
      const rows = (await db.execute(sql`
        SELECT id, body FROM user_memory
        WHERE user_id = ${userId}::uuid AND is_active AND embedding IS NOT NULL
        ORDER BY embedding <=> ${c.vec}::vector
        LIMIT ${NEIGHBOR_LIMIT}
      `)) as unknown as Array<{ id: string; body: string }>;
      for (const r of rows) neighbors.set(r.id, r.body);
    } catch {
      /* fewer neighbors, still fine */
    }
  }

  // New user (no existing facts) → skip the judge, insert everything.
  const decisions: Decision[] =
    neighbors.size === 0
      ? cands.map(() => ({ action: "insert" }))
      : parseDecisions(
          await callLlmJson(
            extractionModel(),
            JUDGE_SYSTEM,
            buildJudgeInput(
              cands.map((c) => c.fact),
              neighbors,
            ),
            600,
          ),
          cands.length,
        );

  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < cands.length; i++) {
        const d = decisions[i];
        if (d.action === "skip") continue;
        if (d.action === "replace" && d.replaceId) {
          // Supersede the old fact (soft-delete). Scoped to the caller.
          await tx.execute(sql`
            UPDATE user_memory
            SET is_active = false, superseded_at = now(), updated_at = now()
            WHERE id = ${d.replaceId}::uuid AND user_id = ${userId}::uuid AND is_active
          `);
        }
        const c = cands[i];
        const title = c.fact.slice(0, 120);
        // ON CONFLICT against the partial unique (user_id, md5(body)) WHERE
        // is_active — the double-insert guard.
        await tx.execute(sql`
          INSERT INTO user_memory (user_id, source_type, title, body, embedding, source_conversation_id)
          VALUES (${userId}::uuid, 'chat', ${title}, ${c.fact}, ${c.vec}::vector, ${conversationId}::uuid)
          ON CONFLICT (user_id, md5(body)) WHERE is_active DO NOTHING
        `);
      }
    });
  } catch {
    /* best-effort; never surface to the chat path */
  }
}
