// Split the stored Metis prompt's source rules into the two audience blocks.
//
// WHY: `## KNOWLEDGE SOURCE PROTECTION` currently lives inline in
// site_setting.workspace_chat_prompt.systemPrompt and asserts that it holds
// "under all conditions", with no overrides. That is correct for client
// sessions and wrong for internal ones, where the library is a working tool and
// hiding it makes Metis worse at its job.
//
// It cannot be softened in place. An absolute anti-injection rule with an
// "unless admin" carve-out invites the model to reason about whether the
// carve-out applies, which is the crack an injection attempt widens. So the
// section moves OUT of systemPrompt and into `sourceProtection`, and a
// separate, mutually exclusive `sourceAttribution` block is added. Exactly one
// reaches any given turn (lib/chat/prompt-config-shared.ts: resolveSourceBlock).
//
// Usage (DEV):  node --env-file=.env.local scripts/split-chat-prompt-source-blocks.mjs [--apply]
// Usage (PROD): DATABASE_URL="<prod>" node scripts/split-chat-prompt-source-blocks.mjs [--apply]
// Default is a DRY RUN — prints the exact before/after and writes nothing.
//
// Idempotent: re-running after a successful apply detects the split is already
// done and exits without touching the row.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

const KEY = "workspace_chat_prompt";
const SECTION = "## KNOWLEDGE SOURCE PROTECTION";

// The internal-session block. This is the substantive half of the change: it is
// what lets Metis do the thing the library exists for — hold a position and
// argue across named works — rather than blending them into an unattributable
// summary. Deliberately NOT a citation format. Citation markers make prose read
// like a literature review; naming a work mid-sentence is how a consultant
// actually talks.
const ATTRIBUTION = `## SOURCE HANDLING — INTERNAL SESSION

You are working with the practice's own library, with someone who owns it. Name
what you draw on and argue with it.

- Name the work in prose as you use it — "Block's point about naming the
  resistance", "Kimball would model this as a conformed dimension". Not
  footnotes, not citation markers, not a reference list at the end.
- When two works pull in different directions, say so, then commit: which one
  applies HERE, and why the other one loses in this situation. A tension you
  name and resolve is worth more than three works agreeing.
- Separate what the material says from what you think. "The material covers X;
  what it does not address, and what I would actually do, is Y." Never blur
  those two together.
- When the library has nothing useful on the question, say that plainly and
  answer from your own judgement, flagged as such. Silence about a gap reads as
  false grounding.
- Never invent a title, an author, or a claim. If you did not draw on a work,
  do not name it.

This block applies to internal sessions only. It replaces the client-session
source rules entirely — the two never appear together.`;

const [row] = await sql`SELECT value FROM site_setting WHERE key = ${KEY}`;
if (!row) {
  console.error(`No site_setting row for '${KEY}'. Nothing to split.`);
  process.exit(1);
}

const value = row.value;
const original = value.systemPrompt ?? "";

if (value.sourceProtection || value.sourceAttribution) {
  console.log("Already split — sourceProtection/sourceAttribution present. No change.");
  await sql.end();
  process.exit(0);
}

const start = original.indexOf(SECTION);
if (start === -1) {
  console.error(`Could not find '${SECTION}' in the stored systemPrompt.`);
  console.error("Refusing to guess. Inspect the prompt and update this script.");
  process.exit(1);
}

// The section runs to the next top-level heading, or to the end.
const rest = original.slice(start + SECTION.length);
const nextHeading = rest.search(/^## /m);
const end = nextHeading === -1 ? original.length : start + SECTION.length + nextHeading;

const protection = original.slice(start, end).trim();
const remaining = (original.slice(0, start) + original.slice(end)).replace(/\n{3,}/g, "\n\n").trim();

console.log(`Target: ${isLocal ? "DEV (local)" : "PROD (remote)"}`);
console.log(`Mode:   ${APPLY ? "APPLY — will write" : "DRY RUN — writes nothing"}\n`);
console.log(`systemPrompt      ${original.length} -> ${remaining.length} chars`);
console.log(`sourceProtection  0 -> ${protection.length} chars  (extracted verbatim, unchanged)`);
console.log(`sourceAttribution 0 -> ${ATTRIBUTION.length} chars  (new)`);
console.log(`version           ${value.version} -> ${value.version}-split\n`);

console.log("--- extracted into sourceProtection (first 300 chars) ---");
console.log(protection.slice(0, 300) + "\n...");
console.log("\n--- headings remaining in systemPrompt ---");
for (const m of remaining.matchAll(/^##+ .*$/gm)) console.log("  " + m[0]);

// Safety: the protection text must leave systemPrompt entirely, or a client
// turn would get it twice and an internal turn would get it alongside the
// contradicting attribution block — the exact failure this change removes.
if (remaining.includes(SECTION)) {
  console.error("\nABORT: the protection heading is still present in systemPrompt.");
  process.exit(1);
}
if (remaining.length < 500) {
  console.error("\nABORT: systemPrompt collapsed to under 500 chars. Extraction went wrong.");
  process.exit(1);
}

if (!APPLY) {
  console.log("\nDry run complete. Re-run with --apply to write.");
  await sql.end();
  process.exit(0);
}

const next = {
  ...value,
  systemPrompt: remaining,
  sourceProtection: protection,
  sourceAttribution: ATTRIBUTION,
  version: `${value.version}-split`,
};

await sql`UPDATE site_setting SET value = ${sql.json(next)}, updated_at = now() WHERE key = ${KEY}`;
console.log("\nApplied.");
await sql.end();
