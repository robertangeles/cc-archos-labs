// Seed site_setting.blog_agent_config from what is actually in the database.
//
//   node --env-file=.env.local scripts/seed-blog-agent-config.mjs [--enable] [--daily]
//
// Every id is DERIVED, never hardcoded: the workflow by name, the author by
// slug, the categories by slug, and the four input field ids by sort order
// (with a label sanity check). That matters because workflow field ids are
// runtime data — deleting and re-adding a field in the builder mints a new
// one — so a hardcoded map goes stale silently. Re-run this after any edit to
// the workflow's input fields.
//
// Idempotent: upserts the row. Ships the config DISABLED unless --enable is
// passed, and with minQueueDepth 0 so a test run cannot also trigger a
// Perplexity batch generation you did not ask for.

import postgres from "postgres";

const WORKFLOW_NAME = "Archos Labs Blog";
const AUTHOR_SLUG = "robangeles";

const args = new Set(process.argv.slice(2));
const enable = args.has("--enable");
const daily = args.has("--daily");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function fail(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exitCode = 1;
}

try {
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`Target: ${host} (${host === "127.0.0.1" ? "DEV" : "!!! NOT DEV !!!"})`);

  // --- workflow ------------------------------------------------------------
  const [wf] = await sql`
    SELECT id, user_id FROM workflow WHERE name = ${WORKFLOW_NAME} LIMIT 1
  `;
  if (!wf) throw new Error(`No workflow named "${WORKFLOW_NAME}".`);

  const steps = await sql`
    SELECT step_id FROM workflow_step WHERE workflow_id = ${wf.id}
  `;
  if (steps.length === 0) throw new Error("Workflow has no steps.");

  // --- input fields, by sort order -----------------------------------------
  const fields = await sql`
    SELECT field_id, label, sort_order FROM workflow_field
     WHERE workflow_id = ${wf.id} ORDER BY sort_order
  `;
  if (fields.length < 4) {
    throw new Error(`Expected 4 input fields, found ${fields.length}.`);
  }

  // Sanity-check the ordering against the labels rather than trusting position
  // blindly — a reordered form would otherwise silently swap topic and audience.
  const expect = [/focus|topic/i, /reader|audience/i, /reaction|action/i, /word count/i];
  fields.slice(0, 4).forEach((f, i) => {
    if (!expect[i].test(f.label)) {
      console.warn(
        `  WARN: field ${i} label "${f.label}" does not look like ${expect[i]}. ` +
          `Check the mapping before enabling.`,
      );
    }
  });

  const fieldMap = {
    topic: fields[0].field_id,
    audience: fields[1].field_id,
    action: fields[2].field_id,
    wordCount: fields[3].field_id,
  };

  // --- author --------------------------------------------------------------
  const [author] = await sql`
    SELECT id, name FROM author WHERE slug = ${AUTHOR_SLUG} LIMIT 1
  `;
  if (!author) throw new Error(`No author with slug "${AUTHOR_SLUG}".`);

  // --- categories ----------------------------------------------------------
  const categoryMap = {
    "Data Foundations": "data-as-a-decision-infrastructure",
    "AI Readiness": "ai-as-strategy",
    "Build Without a Team": "human-centered-transformation",
    "Getting to ROI": "the-execution-layer",
  };
  const slugs = Object.values(categoryMap);
  const found = await sql`SELECT slug FROM category WHERE slug = ANY(${slugs})`;
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  if (missing.length > 0) {
    throw new Error(`Category slugs not in the DB: ${missing.join(", ")}`);
  }

  // --- word bands, read off the real dropdown ------------------------------
  const options = fields[3].options ?? [];
  const bandList = Array.isArray(options) ? options : JSON.parse(options || "[]");
  const long = bandList.find((o) => /1000/.test(o)) ?? "1000-1200 Words";
  const short = bandList.find((o) => /700/.test(o)) ?? "700-750 Words";

  const config = {
    enabled: enable,
    workflowId: wf.id,
    runAsUserId: wf.user_id,
    authorId: author.id,
    fieldMap,
    wordBands: { long, short },
    categoryMap,
    judgeModel: "deepseek/deepseek-chat",
    minGroundingRatio: 0.5,
    duplicateThreshold: 0.25,
    linkAllowlist: [
      "archoslabs.xyz",
      "robertangeles.com",
      "nist.gov",
      "europa.eu",
      "oecd.org",
      "gartner.com",
      "mckinsey.com",
    ],
    // 0 so a manual test run cannot also fire a Perplexity batch generation.
    // Raise it once the pipeline is actually running on a schedule.
    minQueueDepth: 0,
    velocity: daily
      ? { startDate: "2026-01-01", weeklyRamp: [7] }
      : { startDate: "2026-01-01", weeklyRamp: [2, 3, 5, 7] },
    alertEmail: "",
  };

  await sql`
    INSERT INTO site_setting (key, value, updated_at)
    VALUES ('blog_agent_config', ${sql.json(config)}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${sql.json(config)}, updated_at = now()
  `;

  console.log("\nSeeded site_setting.blog_agent_config:");
  console.log(`  workflow      ${wf.id}`);
  console.log(`  runAsUserId   ${wf.user_id}`);
  console.log(`  author        ${author.id} (${author.name})`);
  console.log(`  wordBands     long="${long}"  short="${short}"`);
  console.log(`  fieldMap`);
  for (const [k, v] of Object.entries(fieldMap)) {
    const label = fields.find((f) => f.field_id === v)?.label ?? "?";
    console.log(`    ${k.padEnd(10)} ${v}  ← "${label.slice(0, 52)}"`);
  }
  console.log(`  enabled       ${config.enabled}${enable ? "" : "  (pass --enable to turn on)"}`);
  console.log(`  cadence       ${daily ? "daily" : "ramped 2→7 per week"}`);
  console.log(`  minQueueDepth ${config.minQueueDepth}  (no auto batch generation)`);
} catch (err) {
  fail(err.message);
} finally {
  await sql.end();
}
