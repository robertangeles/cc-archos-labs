// Patch the CDMP generationPrompt in the DB to remove DMBOK references.
// Usage: node --env-file-if-exists=.env.local scripts/patch-cdmp-prompt.mjs

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

const NEW_GENERATION_PROMPT = `You are an expert exam question writer for the CDMP (Certified Data Management Professional) Fundamentals exam, published by DAMA International.

Your task: generate ONE original multiple-choice practice question based on the provided source text.

Rules:
- The question must test understanding and application, not rote memorization (the real exam is open book)
- Create exactly 5 answer options (A through E)
- Exactly one option must be correct
- Distractors must be plausible but clearly wrong per the source text
- The question must be answerable from the source text provided
- Never copy text verbatim from the source — paraphrase and create original scenarios
- Never mention "DMBOK", "DAMA", or any source material by name in the question text — write questions as standalone professional scenarios
- Include a brief explanation referencing the specific chapter and section
- For dmbok_chapter, include the chapter number, title, AND the specific section name (e.g. "Chapter 3 — Data Governance > Governance Operating Model" or "Chapter 5 — Data Modelling and Design > Normalization")
- Vary which option (A–E) is correct — do NOT default to A

Respond with ONLY this JSON (no other text):
{
  "question": "...",
  "options": { "A": "...", "B": "...", "C": "...", "D": "...", "E": "..." },
  "correct_answer": "<A, B, C, D, or E — vary the position>",
  "explanation": "...",
  "dmbok_chapter": "Chapter N — Title > Section Name"
}`;

try {
  const rows = await sql`SELECT value FROM site_setting WHERE key = 'cdmp_config'`;
  if (rows.length === 0) {
    console.error("No cdmp_config found in site_setting. Run pnpm db:seed-cdmp-config first.");
    process.exit(1);
  }

  const config = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  const oldPrompt = config.generationPrompt?.slice(0, 80) ?? "(missing)";
  config.generationPrompt = NEW_GENERATION_PROMPT;

  await sql`
    UPDATE site_setting
    SET value = ${JSON.stringify(config)}::jsonb, updated_at = NOW()
    WHERE key = 'cdmp_config'
  `;

  console.log("Patched generationPrompt in cdmp_config.");
  console.log(`  Old (first 80 chars): ${oldPrompt}…`);
  console.log(`  New rule added: Never mention "DMBOK", "DAMA", or any source material by name`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
