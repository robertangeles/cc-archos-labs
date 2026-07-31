// Retag the knowledge library: real titles, authors, topic domains, and
// explicit CDMP exam-pool membership.
//
// WHY: the stored corpus carried raw filenames as titles (one is literally
// 'ABUIABA9GAAghIK0ugYowM2h3QY' — Chip Huyen's Designing Machine Learning
// Systems) and used the free-text `category` as if it were an exam-approval
// flag. Measured in PROD 2026-07-31: 15 of 19 documents were tagged 'dmbok'
// and therefore feeding CDMP certification question generation, including
// The Trusted Advisor, Flawless Consulting and The Pragmatic Programmer.
//
// Every document below was identified by READING SAMPLE CHUNKS, not by parsing
// the filename — filenames here are unreliable and several are meaningless.
// Each identification was made by one analyst and then adversarially reviewed
// by a second that had not seen the first's reasoning; the two extraction-quality
// downgrades were independently re-verified against the raw chunk text before
// being recorded here.
//
// Usage (DEV):  node --env-file=.env.local scripts/retag-knowledge-corpus.mjs [--apply]
// Usage (PROD): DATABASE_URL="<prod>" node scripts/retag-knowledge-corpus.mjs [--apply]
// Default is a DRY RUN. --apply writes, after snapshotting the current values
// to a timestamped JSON file next to the script's working directory.
//
// Idempotent: re-running after an apply is a no-op diff.
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

// The five canonical topic domains. This list is the vocabulary — the retrieval
// fan-out and any future shelf must agree with it.
export const DOMAINS = ["dmbok", "consulting", "engineering", "analytics", "startup"];

// isCdmp is a SEPARATE axis from domain, deliberately. The Unified Star Schema
// is the case that proves it: data-management by topic, but built on a
// proprietary technique that is not DAMA syllabus — so domain 'dmbok',
// isCdmp false. Exactly two documents are certification material.
const MAPPING = [
  { id: "fef259c0-a2e3-4d32-95d8-b1d4655bbf9c", title: "DAMA-DMBOK: Data Management Body of Knowledge, 2nd Edition", author: "DAMA International", year: 2017, domain: "dmbok", isCdmp: true },
  { id: "1970d592-701d-4d36-ac43-a5d057a75d6c", title: "The Data Warehouse Toolkit: The Definitive Guide to Dimensional Modeling, 3rd Edition", author: "Ralph Kimball and Margy Ross", year: 2013, domain: "dmbok", isCdmp: true },
  { id: "f7e5f1c7-e438-4e6e-8f01-175faf72e006", title: "The Unified Star Schema: An Agile and Resilient Approach to Data Warehouse and Analytics Design", author: "Bill Inmon and Francesco Puppini", year: 2021, domain: "dmbok", isCdmp: false, note: "BROKEN extraction — 10 chunks for a ~250pp book; the Bridge is proprietary, not DAMA syllabus" },

  { id: "f6123cee-4028-4d0f-88d2-a9de9f8cdfe5", title: "The Trusted Advisor (20th Anniversary Edition)", author: "David H. Maister, Charles H. Green and Robert M. Galford", year: 2021, domain: "consulting", isCdmp: false },
  { id: "db2e42d0-005f-4710-a535-d885b00b391a", title: "Flawless Consulting (2nd Edition)", author: "Peter Block", year: 2000, domain: "consulting", isCdmp: false },
  { id: "bafaa1d2-cd31-4ab9-855f-7218168134a1", title: "The McKinsey Way", author: "Ethan M. Rasiel", year: 1999, domain: "consulting", isCdmp: false },
  { id: "f1128438-a433-4d8a-87b4-da5f4a7336d3", title: "The McKinsey Mind", author: "Ethan M. Rasiel and Paul N. Friga", year: 2001, domain: "consulting", isCdmp: false },

  { id: "bbfa89a5-92e3-4392-9000-a24331d17cea", title: "Data Strategy (2nd Edition)", author: "Bernard Marr", year: 2021, domain: "analytics", isCdmp: false },
  { id: "045da7fd-ed55-4fdd-98d8-24f128a7e447", title: "Competing on Analytics (Updated Edition)", author: "Thomas H. Davenport and Jeanne G. Harris", year: 2017, domain: "analytics", isCdmp: false },

  { id: "e1782b2c-e443-4a30-821d-7409a61ca311", title: "Building a Scalable Data Warehouse with Data Vault 2.0", author: "Daniel Linstedt and Michael Olschimke", year: 2016, domain: "engineering", isCdmp: false },
  { id: "a5a0c896-9d58-4f24-a61e-b40ef379b646", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", year: 2017, domain: "engineering", isCdmp: false },
  { id: "ba578da5-3e46-47d5-a4ab-0e78ea882ee0", title: "Designing Machine Learning Systems", author: "Chip Huyen", year: 2022, domain: "engineering", isCdmp: false, note: "SUSPECT extraction — letter-spaced OCR garble in table content ('T a b l e 4 - 3')" },
  { id: "d58487e8-133a-4563-982c-c4f7ff03fd18", title: "Implementing Data Mesh", author: "Jean-Georges Perrin and Eric Broda", year: 2024, domain: "engineering", isCdmp: false },
  { id: "ad8ff382-8db3-4fe6-81ff-28abf82bcc3f", title: "Clean Architecture: A Comprehensive Beginner's Guide", author: "Elijah Lewis", year: 2020, domain: "engineering", isCdmp: false, note: "thin at 53 chunks; generic content-mill prose. Spot-check before relying on it" },
  { id: "86f99015-b8bd-44f4-8993-295e219792d5", title: "The Pragmatic Programmer (20th Anniversary Edition)", author: "David Thomas and Andrew Hunt", year: 2019, domain: "engineering", isCdmp: false },
  { id: "7b916e9a-9543-4fa2-8748-2f1c84041110", title: "The Art of Doing Science and Engineering: Learning to Learn", author: "Richard W. Hamming", year: 1997, domain: "engineering", isCdmp: false, note: "forced fit — research methodology and creativity essays, not software craft. Taxonomy gap, not a miscall" },
  { id: "0d3af391-89cf-444d-976b-025dc2cde416", title: "Staff Engineer: Leadership Beyond the Management Track", author: "Will Larson", year: 2021, domain: "engineering", isCdmp: false },
  { id: "b744afc4-ff07-4d13-b1a6-4bc354d72b17", title: "Deciphering Data Architectures", author: "James Serra", year: 2023, domain: "engineering", isCdmp: false },
  { id: "f5bd5514-9a5e-4c15-b564-d763cd51cef1", title: "Fundamentals of Data Engineering", author: "Joe Reis and Matt Housley", year: 2022, domain: "engineering", isCdmp: false },
];

const bad = MAPPING.filter((m) => !DOMAINS.includes(m.domain));
if (bad.length) {
  console.error("Mapping uses domains outside the canonical list:", bad.map((b) => b.domain));
  process.exit(1);
}

const current = await sql`
  SELECT id, title, category, chunk_count, author, publication_year, is_cdmp_source
  FROM knowledge_document WHERE status = 'ready' ORDER BY created_at`;

// Refuse to run against a corpus this mapping was not built for. A retag keyed
// by id that silently skips unknown rows would leave new documents sitting in a
// stale category with is_cdmp_source at its default — quiet, and wrong.
const known = new Set(MAPPING.map((m) => m.id));
const unmapped = current.filter((d) => !known.has(d.id));
if (unmapped.length) {
  console.error(`ABORT: ${unmapped.length} ready document(s) are not in the mapping:`);
  for (const d of unmapped) console.error(`  ${d.id}  ${d.title.slice(0, 60)}`);
  console.error("Identify them from their chunk content and add them before retagging.");
  process.exit(1);
}
const missing = MAPPING.filter((m) => !current.some((d) => d.id === m.id));
if (missing.length) {
  console.error(`ABORT: ${missing.length} mapped document(s) are not in this database:`);
  for (const m of missing) console.error(`  ${m.id}  ${m.title.slice(0, 60)}`);
  console.error("This mapping was built against PROD. Run E7 (pull PROD books to DEV) first.");
  process.exit(1);
}

console.log(`Target: ${isLocal ? "DEV (local)" : "PROD (remote)"}`);
console.log(`Mode:   ${APPLY ? "APPLY — will write" : "DRY RUN — writes nothing"}\n`);

let changes = 0;
for (const m of MAPPING) {
  const d = current.find((x) => x.id === m.id);
  const diffs = [];
  if (d.title !== m.title) diffs.push(`title: ${JSON.stringify(d.title.slice(0, 44))} -> ${JSON.stringify(m.title.slice(0, 44))}`);
  if (d.category !== m.domain) diffs.push(`category: ${d.category} -> ${m.domain}`);
  if (d.author !== m.author) diffs.push(`author: ${d.author ?? "(null)"} -> ${m.author}`);
  if (d.publication_year !== m.year) diffs.push(`year: ${d.publication_year ?? "(null)"} -> ${m.year}`);
  if (d.is_cdmp_source !== m.isCdmp) diffs.push(`is_cdmp_source: ${d.is_cdmp_source} -> ${m.isCdmp}`);
  if (diffs.length === 0) continue;
  changes++;
  console.log(`${m.title.slice(0, 58)}`);
  for (const x of diffs) console.log(`    ${x}`);
  if (m.note) console.log(`    NOTE: ${m.note}`);
}

const cdmpNow = current.filter((d) => d.category === "dmbok").length;
const cdmpAfter = MAPPING.filter((m) => m.isCdmp).length;
console.log(`\n${changes} of ${MAPPING.length} documents change.`);
console.log(`CDMP exam pool: ${cdmpNow} (everything tagged 'dmbok') -> ${cdmpAfter} (explicitly approved)`);
console.log("Domain spread after:");
for (const dom of DOMAINS) {
  const n = MAPPING.filter((m) => m.domain === dom).length;
  console.log(`  ${dom.padEnd(12)} ${n}${n === 0 ? "   <- no shelf yet" : ""}`);
}
const flagged = MAPPING.filter((m) => m.note);
if (flagged.length) {
  console.log(`\n${flagged.length} document(s) carry an extraction/quality note — see --apply output or the source.`);
}

if (!APPLY) {
  console.log("\nDry run complete. Re-run with --apply to write.");
  await sql.end();
  process.exit(0);
}

// Snapshot BEFORE writing. The retag is otherwise irreversible — the old
// filename-titles and category values exist nowhere else.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const snapPath = `knowledge-corpus-before-retag-${isLocal ? "dev" : "prod"}-${stamp}.json`;
writeFileSync(snapPath, JSON.stringify(current, null, 2));
console.log(`\nSnapshot written to ${snapPath}`);

for (const m of MAPPING) {
  await sql`
    UPDATE knowledge_document
    SET title = ${m.title},
        category = ${m.domain},
        author = ${m.author},
        publication_year = ${m.year},
        is_cdmp_source = ${m.isCdmp},
        updated_at = now()
    WHERE id = ${m.id}`;
}
console.log(`Applied to ${MAPPING.length} documents.`);

const after = await sql`
  SELECT category, count(*)::int n, count(*) FILTER (WHERE is_cdmp_source)::int cdmp
  FROM knowledge_document WHERE status = 'ready' GROUP BY category ORDER BY category`;
console.log("\nVerified:");
for (const r of after) console.log(`  ${r.category.padEnd(12)} ${r.n} docs, ${r.cdmp} in CDMP pool`);

await sql.end();
