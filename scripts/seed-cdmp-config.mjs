// Seed the CDMP practice exam config into site_setting.
// Usage: pnpm db:seed-cdmp-config

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

// Import the starter config inline (can't import .ts from .mjs)
// This must stay in sync with lib/cdmp/config-shared.ts CDMP_CONFIG_STARTER
const config = {
  version: "1.0.0",
  generationPrompt: `You are an expert exam question writer for the CDMP (Certified Data Management Professional) Fundamentals exam, published by DAMA International.

Your task: generate ONE original multiple-choice practice question based on the provided DMBOK source text.

Rules:
- The question must test understanding and application, not rote memorization (the real exam is open book)
- Create exactly 5 answer options (A through E)
- Exactly one option must be correct
- Distractors must be plausible but clearly wrong per the source text
- The question must be answerable from the source text provided
- Never copy text verbatim from the source — paraphrase and create original scenarios
- Include a brief explanation referencing the specific DMBOK section
- For dmbok_chapter, include the chapter number, title, AND the specific section name (e.g. "Chapter 3 — Data Governance > Governance Operating Model" or "Chapter 5 — Data Modelling and Design > Normalization")

Respond with ONLY this JSON (no other text):
{
  "question": "...",
  "options": { "A": "...", "B": "...", "C": "...", "D": "...", "E": "..." },
  "correct_answer": "A",
  "explanation": "...",
  "dmbok_chapter": "Chapter N — Title > Section Name"
}`,
  verificationPrompt: `You are verifying a practice exam question for the CDMP certification.

Your task: determine whether the question and its stated correct answer are factually grounded in the provided source text.

Check:
1. Is the question factually grounded in the source text?
2. Is the stated correct answer actually correct per the source text?
3. Are the distractors plausible but clearly wrong per the source text?
4. Does the question test understanding, not just recall?

Respond with ONLY this JSON (no other text). Keep reason under 50 words. Do not quote the source text.
{"verified": true, "reason": "..."}
or
{"verified": false, "reason": "..."}`,
  knowledgeAreas: [
    { slug: "data_governance", label: "Data Governance", weight: 0.11, chapter: "Chapter 3" },
    { slug: "data_modelling_design", label: "Data Modelling & Design", weight: 0.11, chapter: "Chapter 5" },
    { slug: "data_quality", label: "Data Quality", weight: 0.11, chapter: "Chapter 13" },
    { slug: "metadata_management", label: "Metadata Management", weight: 0.11, chapter: "Chapter 12" },
    { slug: "master_reference_data", label: "Master & Reference Data", weight: 0.10, chapter: "Chapter 10" },
    { slug: "data_warehousing_bi", label: "Data Warehousing & BI", weight: 0.10, chapter: "Chapter 11" },
    { slug: "data_architecture", label: "Data Architecture", weight: 0.06, chapter: "Chapter 4" },
    { slug: "data_storage_operations", label: "Data Storage & Operations", weight: 0.06, chapter: "Chapter 6" },
    { slug: "data_security", label: "Data Security", weight: 0.06, chapter: "Chapter 7" },
    { slug: "data_integration_interoperability", label: "Data Integration & Interoperability", weight: 0.06, chapter: "Chapter 8" },
    { slug: "document_content_management", label: "Document & Content Management", weight: 0.06, chapter: "Chapter 9" },
    { slug: "data_ethics", label: "Data Ethics", weight: 0.02, chapter: "Chapter 2" },
    { slug: "big_data", label: "Big Data & Data Science", weight: 0.02, chapter: "Chapter 14" },
    { slug: "data_management_process", label: "Data Management Process", weight: 0.02, chapter: "Chapter 1" },
  ],
  passThresholds: { associate: 60, practitioner: 70, master: 80 },
  questionCounts: [20, 40, 60, 100],
  timerMinutesPer100: 90,
  maxRetries: 2,
  chunksPerQuestion: 3,
  generationMaxTokens: 800,
  verificationMaxTokens: 500,
};

try {
  const existing = await sql`SELECT id FROM site_setting WHERE key = 'cdmp_config'`;

  if (existing.length > 0) {
    await sql`
      UPDATE site_setting
      SET value = ${JSON.stringify(config)}::jsonb, updated_at = NOW()
      WHERE key = 'cdmp_config'
    `;
    console.log("Updated existing cdmp_config row.");
  } else {
    await sql`
      INSERT INTO site_setting (key, value)
      VALUES ('cdmp_config', ${JSON.stringify(config)}::jsonb)
    `;
    console.log("Inserted new cdmp_config row.");
  }

  console.log("CDMP config seeded successfully.");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
