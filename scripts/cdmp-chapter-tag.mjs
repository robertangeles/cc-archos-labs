// CDMP Specialist exams — chapter backfill for the DMBOK knowledge_chunk rows.
//
// Tags each DMBOK chunk with its DMBOK2 chapter ("Chapter N") IN PLACE, so the
// specialist exam generator can scope retrieval to a single chapter. NULL =
// front/back matter or unassignable (excluded from specialist pools). Only the
// DMBOK document is touched; the Kimball "Data Warehouse Toolkit" chunks (also
// category='dmbok') stay NULL. Embeddings/content are never modified, so the
// Fundamentals exam (semantic search over category='dmbok') is unaffected.
//
// Detection: the PDF running header leads each chunk (odd pages = chapter name,
// even pages = page number + "DMBOK2"). We find each chapter's first sustained
// header anchor after the front matter, enforce book order, and assign every
// chunk to the most-recent chapter start.
//
// Usage (DEV):  node --env-file=.env.local scripts/cdmp-chapter-tag.mjs [--apply]
// Usage (PROD): DATABASE_URL="<prod>" node scripts/cdmp-chapter-tag.mjs [--apply]
// Default is a DRY-RUN (prints the chapter map, writes nothing). Add --apply to write.
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.DBURL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

// short, distinctive DMBOK2 chapter header keys (normalized). order = book order.
const CH = [
  { n: 2, keys: ["datahandlingethics", "datahandling"] },
  { n: 3, keys: ["datagovernance"] },
  { n: 4, keys: ["dataarchitecture"] },
  { n: 5, keys: ["datamodeling", "datamodelling"] },
  { n: 6, keys: ["datastorageandoperations", "datastorage"] },
  { n: 7, keys: ["datasecurity"] },
  { n: 8, keys: ["dataintegrationandinteroperability", "dataintegration"] },
  { n: 9, keys: ["documentandcontentmanagement", "documentandcontent"] },
  { n: 10, keys: ["referenceandmasterdata", "referenceandmaster"] },
  { n: 11, keys: ["datawarehousingandbusinessintelligence", "datawarehousing"] },
  { n: 12, keys: ["metadatamanagement"] },
  { n: 13, keys: ["dataquality"] },
  { n: 14, keys: ["bigdataanddatascience", "bigdata"] },
];
const SPECIALIST = { 3: "data_governance", 5: "data_modelling_design", 8: "data_integration_interoperability",
  10: "master_reference_data", 11: "data_warehousing_bi", 12: "metadata_management", 13: "data_quality" };
const FRONT_CUTOFF = 20;     // title page + TOC precede this; real bodies start later
const WIN = 6, SUSTAIN = 2;  // header present in >=2 of next 6 chunks (alternating odd/even pages)
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

try {
  const docs = await sql`
    SELECT id, title FROM knowledge_document
    WHERE category='dmbok' AND title ILIKE 'DMBOK%'`;
  if (docs.length === 0) { console.error("No DMBOK document found in this database."); process.exit(1); }
  if (docs.length > 1) {
    console.error(`Ambiguous: ${docs.length} documents match 'DMBOK%'. Resolve manually before tagging.`);
    process.exit(1);
  }
  const doc = docs[0];
  const chunks = await sql`
    SELECT chunk_index, content FROM knowledge_chunk
    WHERE document_id=${doc.id} ORDER BY chunk_index`;
  if (chunks.length === 0) { console.error("DMBOK document has no chunks — nothing to tag."); process.exit(1); }

  // header anchor per chunk: which chapter name leads the first ~90 normalized chars
  const hdr = chunks.map(({ content }) => {
    const head = norm(content).slice(0, 90);
    for (const c of CH) if (c.keys.some((k) => head.includes(k))) return c.n;
    return null;
  });

  // first sustained anchor per chapter, after the front matter
  const rawStarts = [];
  for (const c of CH) {
    for (let i = FRONT_CUTOFF; i < chunks.length; i++) {
      if (hdr[i] !== c.n) continue;
      let s = 0;
      for (let j = i; j < Math.min(i + WIN, chunks.length); j++) if (hdr[j] === c.n) s++;
      if (s >= SUSTAIN) { rawStarts.push({ n: c.n, idx: i }); break; }
    }
  }
  // enforce book order (drop stray out-of-order hits)
  rawStarts.sort((a, b) => a.idx - b.idx);
  const starts = [];
  let lastN = 0;
  for (const s of rawStarts) if (s.n > lastN) { starts.push(s); lastN = s.n; }

  // assign by most-recent start; null before first start and after Ch14 body
  const assign = new Array(chunks.length).fill(null);
  for (let i = 0; i < chunks.length; i++) {
    let chosen = null;
    for (const s of starts) { if (s.idx <= i) chosen = s.n; else break; }
    assign[i] = chosen;
  }
  let lastCh14 = -1;
  for (let i = 0; i < chunks.length; i++) if (hdr[i] === 14) lastCh14 = i;
  if (lastCh14 >= 0) for (let i = lastCh14 + 1; i < chunks.length; i++) assign[i] = null;

  // report
  console.log(`DMBOK doc: ${doc.title} | chunks: ${chunks.length} | mode: ${APPLY ? "APPLY" : "DRY-RUN"} | target: ${isLocal ? "DEV" : "PROD"}`);
  console.log("starts: " + starts.map((s) => `Ch${s.n}@${s.idx}`).join("  "));
  const counts = {};
  assign.forEach((c) => { if (c) counts[c] = (counts[c] || 0) + 1; });
  console.log("specialist supply: " + Object.keys(SPECIALIST).map((n) => `Ch${n}=${counts[n] || 0}`).join("  "));
  console.log(`null/unassigned: ${assign.filter((c) => c === null).length}/${assign.length}`);

  // Sanity gate: refuse to --apply a map that doesn't look like a clean DMBOK.
  // Guards against a PROD ingest whose chunking differs from DEV (different
  // chunk boundaries shift the positional detection and silently mis-tag).
  const thin = Object.keys(SPECIALIST).filter((n) => (counts[n] || 0) < 15);
  if (thin.length) console.warn(`WARNING: thin specialist chapters (<15 chunks): ${thin.map((n) => "Ch" + n).join(", ")}`);
  const detected = starts.map((s) => s.n);
  const monotonic = detected.every((n, i) => i === 0 || n > detected[i - 1]);
  const tagged = assign.filter((c) => c !== null).length;
  const sane = starts.length >= 12 && monotonic && thin.length === 0 && tagged > 200;

  if (APPLY) {
    if (!sane) {
      console.error(
        "ABORT --apply: detected chapter map failed the sanity gate " +
        `(starts=${starts.length} monotonic=${monotonic} thin=${thin.length} tagged=${tagged}). ` +
        "Expected >=12 chapters in book order, all 7 specialist chapters >=15 chunks, >200 tagged. " +
        "PROD chunking likely differs from DEV — inspect the dry-run output before forcing.",
      );
      process.exit(1);
    }
    let updated = 0;
    await sql.begin(async (tx) => {
      for (let i = 0; i < chunks.length; i++) {
        const val = assign[i] === null ? null : `Chapter ${assign[i]}`;
        // Only write rows whose chapter actually changes (avoids churning updated_at).
        const res = await tx`UPDATE knowledge_chunk SET chapter=${val}, updated_at=now()
                  WHERE document_id=${doc.id} AND chunk_index=${chunks[i].chunk_index}
                    AND chapter IS DISTINCT FROM ${val}`;
        updated += res.count;
      }
    });
    console.log(`APPLIED: ${updated} chunks changed on ${isLocal ? "DEV" : "PROD"}.`);
  } else {
    console.log("DRY-RUN — no writes. Add --apply to backfill.");
  }
} catch (e) {
  console.error("chapter-tag error:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
