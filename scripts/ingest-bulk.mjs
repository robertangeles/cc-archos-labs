// Ingest a whole folder of PDFs into the knowledge library.
//
// WHY THIS EXISTS RATHER THAN A LOOP AROUND ingest-pdf.mjs:
//
// The slow part of adding a book was never the upload. It was deciding what the
// book IS. `pnpm ingest:pdf` needs a hand-typed title and defaults `category` to
// 'dmbok' — which is now actively wrong, since that is the shelf CDMP retrieval
// draws from. Loading 22 startup books that way would have put every one of them
// next to the DAMA syllabus.
//
// Filenames are not a substitute. The existing library ended up with a document
// titled 'ABUIABA9GAAghIK0ugYowM2h3QY' (Chip Huyen's Designing Machine Learning
// Systems) precisely because a filename was trusted as a title.
//
// So each book is identified from its own opening pages: real title, author,
// year, and which of the five domains it belongs on.
//
// is_cdmp_source is ALWAYS false here. A new document is not certification exam
// material until someone approves it deliberately — the old implicit default is
// what put The Trusted Advisor into a data-management exam.
//
// Usage:
//   DATABASE_URL="<target>" node --env-file=.env.local scripts/ingest-bulk.mjs <folder> [--apply]
//
// Dry run by default: identifies every book and prints the plan, writing
// nothing. Re-runnable — anything already ingested is skipped by content hash,
// so an interrupted run resumes where it stopped.
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import postgres from "postgres";
import { chunkText, embedBatch, extractPdf, textQuality } from "./lib/pdf-ingest.mjs";

const folder = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!folder || folder.startsWith("--")) {
  console.error("Usage: node scripts/ingest-bulk.mjs <folder> [--apply]");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!apiKey) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

// The five canonical domains. Must stay in step with CANONICAL_DOMAINS in
// lib/knowledge/retrieve.ts and the retag script — retrieval fans out over this
// vocabulary, so a sixth value invented here would simply never be searched.
const DOMAINS = ["dmbok", "consulting", "engineering", "analytics", "startup"];

const IDENTIFY_MODEL =
  process.env.RETRIEVAL_DECOMPOSE_MODEL?.trim() || "anthropic/claude-haiku-4.5";

/** Identify a book from its opening pages. Falls back to the filename, flagged. */
async function identify(sampleText, filename) {
  const fallback = {
    title: basename(filename, extname(filename)),
    author: null,
    year: null,
    domain: "startup",
    confidence: 0,
    note: "identification failed — filename used, needs review",
  };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IDENTIFY_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Identify a book from the opening pages of its extracted text. " +
              "Return ONLY JSON:\n" +
              '{"title":"proper published title","author":"author(s) as cited",' +
              '"year":"YYYY or null","domain":"one of: ' + DOMAINS.join(", ") + '",' +
              '"confidence":0-10}\n\n' +
              "Domains:\n" +
              "  dmbok       data governance, stewardship, metadata, MDM, data quality, modelling, warehousing\n" +
              "  consulting  client relationships, engagement practice, advisory technique, problem structuring\n" +
              "  engineering software craft, architecture, systems and data engineering\n" +
              "  analytics   analytics strategy, measurement, competing on data\n" +
              "  startup     founders, fundraising, early-stage GTM, product-market fit, company building\n\n" +
              "The FILENAME is unreliable — identify from the content. Use your own " +
              "knowledge of the published work for the correct title and author; do " +
              "not merely tidy up the filename. confidence 9-10 only if you are " +
              "certain which book this is.",
          },
          { role: "user", content: `Filename: ${filename}\n\nOpening text:\n${sampleText.slice(0, 6000)}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return fallback;
    const raw = (await res.json()).choices?.[0]?.message?.content ?? "";
    // Models fence JSON even when asked not to.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s === -1 || e <= s) return fallback;
    const p = JSON.parse(body.slice(s, e + 1));
    if (!p.title) return fallback;
    return {
      title: String(p.title).slice(0, 300),
      author: p.author ? String(p.author).slice(0, 300) : null,
      year: /^\d{4}$/.test(String(p.year)) ? Number(p.year) : null,
      // A domain outside the vocabulary would never be searched. Fall back
      // rather than silently shelving the book somewhere retrieval cannot see.
      domain: DOMAINS.includes(p.domain) ? p.domain : "startup",
      confidence: Number(p.confidence) || 0,
      note: DOMAINS.includes(p.domain) ? null : `model returned domain "${p.domain}" — defaulted`,
    };
  } catch {
    return fallback;
  }
}

const files = readdirSync(folder)
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort();

console.log(`Target : ${isLocal ? "DEV (local)" : "PROD (remote)"}`);
console.log(`Folder : ${folder}`);
console.log(`Mode   : ${APPLY ? "APPLY — will write" : "DRY RUN — writes nothing"}`);
console.log(`Files  : ${files.length}\n`);

const plan = [];
const rejected = [];
let skipped = 0;

for (const [i, f] of files.entries()) {
  const path = join(folder, f);
  process.stdout.write(`[${i + 1}/${files.length}] ${f.slice(0, 58)}\n`);

  let extracted;
  try {
    extracted = await extractPdf(path);
  } catch (err) {
    console.log(`    SKIP — cannot read PDF: ${String(err).slice(0, 90)}\n`);
    continue;
  }

  const [dupe] = await sql`
    SELECT id, title FROM knowledge_document WHERE content_hash = ${extracted.contentHash}`;
  if (dupe) {
    console.log(`    already ingested as "${dupe.title.slice(0, 50)}"\n`);
    skipped++;
    continue;
  }

  let chunks;
  try {
    chunks = chunkText(extracted.text);
  } catch (err) {
    console.log(`    SKIP — ${String(err).slice(0, 110)}\n`);
    continue;
  }
  if (chunks.length === 0) {
    console.log(`    SKIP — no extractable text (scanned image PDF?)\n`);
    continue;
  }

  // Quality gate BEFORE identification, because a book that cannot be read
  // must not enter the library however confidently it can be named. Chunk
  // count is not the detector: Zero to One produced 269k characters and 16
  // chunks, all of it font-encoded gibberish.
  const quality = textQuality(extracted.text, extracted.pages);
  if (!quality.ok) {
    console.log(`    REJECT — ${quality.problems.join("; ")}\n`);
    rejected.push({ file: f, reason: quality.problems.join("; ") });
    continue;
  }
  // A handful of pages is an excerpt or a summary, not the book. Citing it as
  // the book would be a quiet lie about what the answer rests on.
  if (extracted.pages < 20) {
    console.log(`    REJECT — only ${extracted.pages} pages; looks like an excerpt, not the book\n`);
    rejected.push({ file: f, reason: `${extracted.pages} pages — excerpt, not the full work` });
    continue;
  }

  const meta = await identify(extracted.text, f);
  plan.push({ path, ...extracted, chunks, meta, quality });
  console.log(
    `    ${meta.title.slice(0, 52)} — ${meta.author ?? "?"} (${meta.year ?? "?"})\n` +
      `    ${meta.domain} · ${chunks.length} chunks · ${extracted.pages}p · confidence ${meta.confidence}/10` +
      `${meta.note ? `\n    NOTE: ${meta.note}` : ""}\n`,
  );
}

console.log("=".repeat(70));
console.log(`${plan.length} to ingest, ${skipped} already present, ${files.length - plan.length - skipped} skipped`);
const byDomain = {};
for (const p of plan) byDomain[p.meta.domain] = (byDomain[p.meta.domain] ?? 0) + 1;
for (const d of DOMAINS) if (byDomain[d]) console.log(`  ${d.padEnd(12)} ${byDomain[d]}`);
const lowConf = plan.filter((p) => p.meta.confidence < 7);
if (lowConf.length) {
  console.log(`\n${lowConf.length} with confidence < 7 — review the titles before trusting citations:`);
  for (const p of lowConf) console.log(`  ${p.meta.confidence}/10  ${p.meta.title.slice(0, 56)}`);
}
if (rejected.length) {
  console.log(`\n${rejected.length} REJECTED — these need a better source file:`);
  for (const r of rejected) console.log(`  ${r.file.slice(0, 48)}\n      ${r.reason}`);
}
console.log(`\nTotal chunks to embed: ${plan.reduce((n, p) => n + p.chunks.length, 0)}`);

if (!APPLY) {
  console.log("\nDry run complete. Re-run with --apply to ingest.");
  await sql.end();
  process.exit(0);
}

console.log("\n" + "=".repeat(70));
for (const [i, p] of plan.entries()) {
  console.log(`[${i + 1}/${plan.length}] ${p.meta.title.slice(0, 56)}`);

  const embeddings = await embedBatch(p.chunks, apiKey);

  // One transaction per book: a book is either fully in the library or not in
  // it at all. A half-embedded book looks complete to retrieval and quietly
  // answers from a third of its content.
  await sql.begin(async (tx) => {
    const [doc] = await tx`
      INSERT INTO knowledge_document
        (title, source_type, category, content_hash, status, chunk_count,
         author, publication_year, is_cdmp_source)
      VALUES (${p.meta.title}, 'pdf', ${p.meta.domain}, ${p.contentHash}, 'ready',
              ${p.chunks.length}, ${p.meta.author}, ${p.meta.year}, false)
      RETURNING id`;

    for (let c = 0; c < p.chunks.length; c++) {
      await tx`
        INSERT INTO knowledge_chunk (document_id, content, embedding, chunk_index)
        VALUES (${doc.id}, ${p.chunks[c]}, ${`[${embeddings[c].join(",")}]`}::vector, ${c})`;
    }
  });
  console.log(`    ingested ${p.chunks.length} chunks\n`);
}

const after = await sql`
  SELECT category, count(*)::int n FROM knowledge_document
  WHERE status='ready' GROUP BY category ORDER BY category`;
console.log("Library now:");
for (const r of after) console.log(`  ${r.category.padEnd(12)} ${r.n}`);

await sql.end();
