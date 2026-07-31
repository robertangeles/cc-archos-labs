// Copy the book library from PROD into local DEV so retrieval work can be
// developed and measured against the real corpus.
//
// WHY: DEV had 3 documents and PROD has 19, and none of DEV's three are
// consulting books. Any work on cross-domain retrieval was therefore untestable
// locally — the fan-out would look fine against a corpus where every book is
// about data warehousing, then behave differently in production.
//
// SCOPE: knowledge_document + knowledge_chunk only. Books are shared reference
// material with no tenant data in them. Nothing else is copied — not users, not
// conversations, not leads, not memories.
//
// DIRECTION IS ENFORCED STRUCTURALLY, NOT BY CONVENTION.
// The target must resolve to a local host. There is no flag, env var or
// argument that lets this write to a remote database. "Be careful" is not a
// safety mechanism; a refusal is.
//
// Usage:
//   DATABASE_URL="<prod>" node --env-file=.env.local scripts/pull-prod-books.mjs [--apply]
//
// --env-file supplies the DEV target as DATABASE_URL, then the shell-set
// DATABASE_URL overrides it as the SOURCE. Both are read explicitly below so
// the two can never be confused. Dry run by default.
import postgres from "postgres";

const SOURCE_URL = process.env.DATABASE_URL;
const TARGET_URL = process.env.DEV_DATABASE_URL ?? process.env.TARGET_DATABASE_URL;

if (!SOURCE_URL) {
  console.error("Set DATABASE_URL to the SOURCE (PROD) database.");
  process.exit(1);
}
if (!TARGET_URL) {
  console.error("Set DEV_DATABASE_URL to the TARGET (local DEV) database.");
  console.error("Example:");
  console.error('  DEV_DATABASE_URL="postgres://...@127.0.0.1:5432/archos_labs_dev" \\');
  console.error('  DATABASE_URL="<prod>" node scripts/pull-prod-books.mjs --apply');
  process.exit(1);
}

const isLocal = (u) => /(?:@|\/\/)(?:127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u);

// THE GUARD. Everything else in this script is a copy loop; this is the part
// that matters. A remote target is refused unconditionally.
if (!isLocal(TARGET_URL)) {
  console.error("REFUSED: the target is not a local database.");
  console.error("This script only ever writes to 127.0.0.1/localhost. It exists to");
  console.error("pull PROD books DOWN to DEV, and it will not run in the other");
  console.error("direction under any flag.");
  process.exit(1);
}
if (isLocal(SOURCE_URL)) {
  console.error("REFUSED: the source is local. There is nothing to pull.");
  console.error("DATABASE_URL should be the REMOTE source; DEV_DATABASE_URL the local target.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const src = postgres(SOURCE_URL, { max: 1, ssl: "require" });
const dst = postgres(TARGET_URL, { max: 1, ssl: false });

const docs = await src`
  SELECT id, title, source_type, category, content_hash, status, chunk_count,
         last_error, author, publication_year, is_cdmp_source, created_at, updated_at
  FROM knowledge_document WHERE status = 'ready' ORDER BY created_at`;

const [{ count: chunkTotal }] = await src`
  SELECT count(*)::int AS count FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id WHERE d.status = 'ready'`;

const existing = await dst`SELECT id, title FROM knowledge_document`;

console.log(`SOURCE : remote, ${docs.length} ready documents, ${chunkTotal} chunks`);
console.log(`TARGET : local,  ${existing.length} documents currently`);
console.log(`Mode   : ${APPLY ? "APPLY" : "DRY RUN — writes nothing"}\n`);

const existingIds = new Set(existing.map((d) => d.id));
const toCopy = docs.filter((d) => !existingIds.has(d.id));
const alreadyThere = docs.filter((d) => existingIds.has(d.id));

console.log(`${toCopy.length} document(s) to copy, ${alreadyThere.length} already present:`);
for (const d of toCopy) console.log(`  + ${String(d.chunk_count).padStart(4)}  ${d.title.slice(0, 62)}`);
for (const d of alreadyThere) console.log(`  = ${String(d.chunk_count).padStart(4)}  ${d.title.slice(0, 62)}`);

if (!APPLY) {
  console.log("\nDry run complete. Re-run with --apply to copy.");
  await src.end();
  await dst.end();
  process.exit(0);
}

let copiedChunks = 0;
for (const d of toCopy) {
  await dst`
    INSERT INTO knowledge_document
      (id, title, source_type, category, content_hash, status, chunk_count,
       last_error, author, publication_year, is_cdmp_source, created_at, updated_at)
    VALUES (${d.id}, ${d.title}, ${d.source_type}, ${d.category}, ${d.content_hash},
            ${d.status}, ${d.chunk_count}, ${d.last_error}, ${d.author},
            ${d.publication_year}, ${d.is_cdmp_source}, ${d.created_at}, ${d.updated_at})
    ON CONFLICT (id) DO NOTHING`;

  // Chunks in pages. The embedding comes across as text and is cast back to
  // vector on insert — pgvector accepts its own text form losslessly.
  const PAGE = 200;
  for (let off = 0; ; off += PAGE) {
    const rows = await src`
      SELECT id, document_id, content, embedding::text AS embedding, chunk_index, chapter
      FROM knowledge_chunk WHERE document_id = ${d.id}
      ORDER BY chunk_index LIMIT ${PAGE} OFFSET ${off}`;
    if (rows.length === 0) break;
    for (const c of rows) {
      await dst`
        INSERT INTO knowledge_chunk (id, document_id, content, embedding, chunk_index, chapter)
        VALUES (${c.id}, ${c.document_id}, ${c.content},
                ${c.embedding === null ? null : dst`${c.embedding}::vector`},
                ${c.chunk_index}, ${c.chapter})
        ON CONFLICT (id) DO NOTHING`;
    }
    copiedChunks += rows.length;
    process.stdout.write(`\r  ${d.title.slice(0, 40)}: ${off + rows.length} chunks`);
  }
  process.stdout.write("\n");
}

console.log(`\nCopied ${toCopy.length} documents, ${copiedChunks} chunks.`);

const [{ n }] = await dst`SELECT count(*)::int AS n FROM knowledge_chunk WHERE embedding IS NOT NULL`;
const [{ d: docCount }] = await dst`SELECT count(*)::int AS d FROM knowledge_document WHERE status = 'ready'`;
console.log(`DEV now: ${docCount} ready documents, ${n} embedded chunks.`);

await src.end();
await dst.end();
