import { z } from "zod";

const KnowledgeAreaSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
  chapter: z.string().min(1),
});

export const CdmpConfigSchema = z.object({
  version: z.string().min(1),
  generationPrompt: z.string().min(50),
  verificationPrompt: z.string().min(50),
  knowledgeAreas: z.array(KnowledgeAreaSchema).min(1),
  passThresholds: z.object({
    associate: z.number().int().min(0).max(100),
    practitioner: z.number().int().min(0).max(100),
    master: z.number().int().min(0).max(100),
  }),
  questionCounts: z.array(z.number().int().positive()).min(1),
  timerMinutesPer100: z.number().positive(),
  maxRetries: z.number().int().min(0).max(10),
  chunksPerQuestion: z.number().int().min(1).max(10),
  generationMaxTokens: z.number().int().positive(),
  verificationMaxTokens: z.number().int().positive(),
});

export type CdmpConfig = z.infer<typeof CdmpConfigSchema>;
export type KnowledgeArea = z.infer<typeof KnowledgeAreaSchema>;

export const CDMP_CONFIG_STARTER: CdmpConfig = {
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
  passThresholds: {
    associate: 60,
    practitioner: 70,
    master: 80,
  },
  questionCounts: [20, 40, 60, 100],
  timerMinutesPer100: 90,
  maxRetries: 2,
  chunksPerQuestion: 3,
  generationMaxTokens: 800,
  verificationMaxTokens: 500,
};
