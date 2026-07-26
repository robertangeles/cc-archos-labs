// Append hard evidence rules to the essay skill prompt.
//
//   node --env-file=.env.local scripts/patch-essay-evidence-rules.mjs            # DEV
//   DATABASE_URL="<PROD>" node scripts/patch-essay-evidence-rules.mjs            # PROD
//
// Why this exists. Measured across 7 runs in DEV and PROD on 2026-07-26, the
// research step returns ZERO percentages and ZERO currency figures — it comes
// back as narrative prose with [1][2] citation markers. The essay skill is told
// to be specific, so it manufactures figures to fill the gap: "64% of SMBs",
// "340 customers", "412 invoices". The grounding gate then correctly refuses
// them, and nothing publishes.
//
// The gate is not the problem. The supply is. This fixes the supply.
//
// Idempotent: re-running is a no-op once the marker is present.

import postgres from "postgres";

const MARKER = "## Evidence Rules (HARD";

const RULES = `

---

${MARKER} — a draft that breaks these is rejected before anyone reads it)

1. **Every figure must appear verbatim in the research you were given.** Every
   number, percentage, currency amount, count and date. Do not round it, do not
   restate it in different units, do not derive a new figure from two others. If
   the research carries no figure on a point, make the point without one.

2. **Never invent an illustrative number.** "340 customers", "412 invoices",
   "89 tickets" are inventions, not examples — a reader cannot tell them apart
   from research, which is exactly what makes them dishonest. Describe the shape
   of the problem instead: "your CRM, your accounting tool and your inbox each
   hold a different count of the same customer, and none of them agree."

3. **Never claim personal experience.** You are not a person, you have not met
   anyone, and you have not watched anything happen. Banned in every tense and
   contraction: "I have seen", "I've seen", "I saw", "I spent", "I watched",
   "I remember", "I have never seen", "in my experience", "a client told me",
   "last year I". First-person *reasoning* is fine — "I'd start by", "I think
   the trap here is" — because that is argument, not testimony.

4. **Name a source only as the research names it.** If the research does not
   attribute a claim, do not attribute it either.

Specificity comes from naming the mechanism precisely, not from decorating a
sentence with a number you made up. A paragraph that carries no figure passes.
A paragraph that carries an invented one does not.
`;

const SLUG = "archos-paul-graham-essays";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const host = new URL(url).hostname;
const isDev = host === "127.0.0.1" || host === "localhost";
console.log(`target: ${host} (${isDev ? "DEV" : "PROD"})`);

const sql = postgres(url, { ssl: isDev ? false : "require", max: 1 });

try {
  const [skill] = await sql`
    SELECT id, prompt_template FROM skill WHERE slug = ${SLUG} LIMIT 1
  `;
  if (!skill) {
    console.error(`No skill with slug '${SLUG}'.`);
    process.exit(1);
  }

  if (skill.prompt_template.includes(MARKER)) {
    console.log("already patched — nothing to do.");
    process.exit(0);
  }

  const before = skill.prompt_template.length;
  const [updated] = await sql`
    UPDATE skill
       SET prompt_template = prompt_template || ${RULES}, updated_at = now()
     WHERE id = ${skill.id}
    RETURNING length(prompt_template) AS len
  `;
  console.log(`patched: ${before} -> ${updated.len} chars`);
} finally {
  await sql.end();
}
