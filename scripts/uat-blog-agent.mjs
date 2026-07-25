// Acceptance run for the blog writer agent.
//
//   node --env-file=.env.local scripts/uat-blog-agent.mjs            # free checks only
//   node --env-file=.env.local scripts/uat-blog-agent.mjs --write    # + writes one real post (~$1)
//
// Does every mechanical part of the UAT so the human part is only judgement:
// setup, the safety checks, cleanup after itself, and a plain-English report.
// Read wiki/runbooks/blog-writer-agent-uat-checklist.md for what to do with
// the result.
//
// Refuses to run against anything that is not local DEV.

import postgres from "postgres";
import { execFileSync } from "node:child_process";

const WRITE = process.argv.includes("--write");
const BASE = `http://localhost:${process.env.PORT || 3007}`;
const ENDPOINT = `${BASE}/api/cron/write-blog-post`;
const PUBLISHER = `${BASE}/api/cron/process-scheduled-posts`;
const SECRET = process.env.CRON_SECRET;

const results = [];
let sql;

const pass = (label, note = "") => results.push({ ok: true, label, note });
const fail = (label, note = "") => results.push({ ok: false, label, note });

/** Record one check. `note` is shown either way — it explains a pass too. */
function check(ok, label, okNote = "", failNote = "") {
  if (ok) pass(label, okNote);
  else fail(label, failNote);
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function post(url, auth) {
  const res = await fetch(url, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    signal: AbortSignal.timeout(900_000),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* some paths return no body */
  }
  return { status: res.status, body };
}

// Read-modify-write the whole object rather than parameterising jsonb_set.
//
// postgres.js JSON-encodes any parameter bound into a jsonb context, so
// `jsonb_set(value, '{enabled}', ${'true'}::jsonb)` stores the STRING "true",
// not boolean true, and `${JSON.stringify(id)}::jsonb` double-encodes. Both
// then fail BlogAgentConfigSchema, and getBlogAgentConfig quite correctly
// falls back to the disabled starter — so the checks below would report
// "disabled" and look like a product bug when the corruption was ours.
async function patchConfig(mutate) {
  const [row] = await sql`SELECT value FROM site_setting WHERE key = 'blog_agent_config'`;
  const next = structuredClone(row.value);
  mutate(next);
  await sql`
    UPDATE site_setting SET value = ${sql.json(next)}, updated_at = now()
     WHERE key = 'blog_agent_config'`;
}

const setEnabled = (on) => patchConfig((c) => { c.enabled = on; });
const setFieldId = (id) => patchConfig((c) => { c.fieldMap.topic = id; });

try {
  // --- Guard rails ---------------------------------------------------------
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set. Use --env-file=.env.local");
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: DATABASE_URL points at ${host}, not local DEV.`);
  }
  if (!SECRET || SECRET.length < 16) throw new Error("CRON_SECRET missing or too short in .env.local");

  sql = postgres(process.env.DATABASE_URL, { max: 1 });

  // --research: print the source material behind the most recent post, so
  // question 3 of the checklist ("is every number real?") is a lookup rather
  // than an act of faith.
  if (process.argv.includes("--research")) {
    const [run] = await sql`
      SELECT step_results FROM workflow_execution_run ORDER BY created_at DESC LIMIT 1`;
    if (!run) throw new Error("No workflow run found yet. Run with --write first.");
    const step = run.step_results.find((s) => s.outputs?.raw_research);
    if (!step) throw new Error("That run has no research output.");
    console.log("\nRESEARCH THE WRITER WAS GIVEN");
    console.log("=============================");
    console.log("Every figure in the post should appear somewhere below.\n");
    console.log(step.outputs.raw_research);
    console.log("");
    await sql.end();
    process.exit(0);
  }

  console.log("\nBLOG AGENT — ACCEPTANCE RUN");
  console.log("===========================");
  console.log(`Database   ${host} / ${new URL(process.env.DATABASE_URL).pathname.slice(1)}  (local DEV, safe)`);
  console.log(`Mode       ${WRITE ? "full — will write one real post (~$1, ~4 min)" : "free checks only (pass --write to include a real post)"}`);

  // --- Server up? ----------------------------------------------------------
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    console.log(`Server     ${BASE}  (running)`);
  } catch {
    throw new Error(`Dev server not responding at ${BASE}. Run "pnpm dev" in another terminal first.`);
  }

  // --- Setup ---------------------------------------------------------------
  heading("SETUP");

  const [mig] = await sql`SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'content_plan_item'`;
  if (!mig) {
    console.log("  Applying the database change…");
    execFileSync("node", ["--env-file=.env.local", "scripts/db-apply.mjs"], { stdio: "inherit" });
  }
  console.log("  Database change applied");

  execFileSync("node", ["--env-file=.env.local", "scripts/seed-blog-agent-config.mjs", "--enable", "--daily"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [cfgRow] = await sql`SELECT value FROM site_setting WHERE key = 'blog_agent_config'`;
  const cfg = cfgRow.value;
  const [wf] = await sql`SELECT name FROM workflow WHERE id = ${cfg.workflowId}`;
  const [author] = await sql`SELECT name FROM author WHERE id = ${cfg.authorId}`;
  console.log(`  Settings loaded — workflow "${wf.name}", byline "${author.name}"`);

  // --- Safety checks -------------------------------------------------------
  heading("SAFETY CHECKS   (these are what stop a bad post reaching the public)");

  const noAuth = await post(ENDPOINT);
  check(
    noAuth.status === 401,
    "Blocked when nobody signs in",
    "",
    `got ${noAuth.status}, expected 401`,
  );

  const wrongAuth = await post(ENDPOINT, "Bearer wrong-token-padding-value");
  check(
    wrongAuth.status === 401,
    "Blocked with the wrong password",
    "",
    `got ${wrongAuth.status}, expected 401`,
  );

  const wrongScheme = await post(ENDPOINT, `Basic ${SECRET}`);
  check(
    wrongScheme.status === 401,
    "Blocked when the password is right but sent the wrong way",
    "",
    `got ${wrongScheme.status}`,
  );

  await setEnabled(false);
  const off = await post(ENDPOINT, `Bearer ${SECRET}`);
  check(
    off.body?.outcome === "disabled",
    "Stops completely when you switch it off",
    "",
    `got outcome "${off.body?.outcome}"`,
  );
  await setEnabled(true);

  // Broken settings must fail in under a second, not after a 4-minute run.
  const goodFieldId = cfg.fieldMap.topic;
  await setFieldId("nonexistent-field-id");
  const seededItem = await seedItem();
  const t0 = Date.now();
  const broken = await post(ENDPOINT, `Bearer ${SECRET}`);
  const brokenMs = Date.now() - t0;
  await setFieldId(goodFieldId);
  if (broken.body?.outcome === "failed" && brokenMs < 10_000) {
    pass("Refuses to run on broken settings", `stopped in ${(brokenMs / 1000).toFixed(1)}s instead of writing nonsense`);
  } else {
    fail("Refuses to run on broken settings", `outcome "${broken.body?.outcome}" after ${brokenMs}ms`);
  }
  await sql`UPDATE content_plan_item SET status='pending', attempts=0, last_error=NULL WHERE id=${seededItem}`;

  // Crash recovery.
  //
  // Switched OFF for this check, deliberately. runOnce sweeps BEFORE it looks
  // at `enabled` (run.ts: sweep, then the disabled guard), so the sweep still
  // happens and the check is still real — but the run stops there instead of
  // going on to claim the freshly-reclaimed item and write a whole post.
  //
  // Without this, "free checks only" quietly spent ~$1 per invocation: the
  // reclaimed item was immediately claimed and taken through the full
  // research-and-draft pipeline. Three script runs cost about $3 before the
  // stray drafts gave it away.
  await sql`
    UPDATE content_plan_item
       SET status='running', locked_by='uat-dead-worker',
           locked_until = now() - interval '1 hour', attempts = 1
     WHERE id = ${seededItem}`;
  await setEnabled(false);
  const swept = await post(ENDPOINT, `Bearer ${SECRET}`);
  await setEnabled(true);
  const reclaimed = swept.body?.swept?.reclaimed ?? 0;
  check(
    reclaimed >= 1,
    "Recovers by itself after a crash mid-write",
    "",
    "the stuck item was not picked back up",
  );

  // --- The publish gate ----------------------------------------------------
  heading("THE PUBLISH GATE   (the one control between a draft and your public site)");

  const agentPost = await makePost({ agent: true, review: true, slug: "uat-agent-awaiting-review" });
  const humanPost = await makePost({ agent: false, review: true, slug: "uat-human-flagged" });
  await post(PUBLISHER, `Bearer ${SECRET}`);

  const agentStatus = await statusOf(agentPost);
  check(
    agentStatus === "scheduled",
    "An agent post awaiting your review is NOT published",
    "",
    `it became "${agentStatus}"`,
  );

  const humanStatus = await statusOf(humanPost);
  check(
    humanStatus === "published",
    "Your own flagged post still publishes",
    "existing behaviour unchanged",
    `it stayed "${humanStatus}" — this change broke an existing feature`,
  );

  await sql`UPDATE post SET needs_review = false WHERE id = ${agentPost}`;
  await post(PUBLISHER, `Bearer ${SECRET}`);
  const afterApproval = await statusOf(agentPost);
  check(
    afterApproval === "published",
    "Once you approve it, it publishes",
    "",
    `it stayed "${afterApproval}"`,
  );

  await sql`DELETE FROM post WHERE slug IN ('uat-agent-awaiting-review','uat-human-flagged')`;

  // --- The real write ------------------------------------------------------
  let writtenPostId = null;
  if (WRITE) {
    heading("WRITING A REAL POST   (3-6 minutes — research, draft, review)");
    console.log("  Working…");
    const t = Date.now();
    const run = await post(ENDPOINT, `Bearer ${SECRET}`);
    const secs = Math.round((Date.now() - t) / 1000);

    if (run.body?.outcome === "drafted" && run.body.postId) {
      writtenPostId = run.body.postId;
      pass("Wrote a post and held it for review", `${secs}s`);
    } else if (run.body?.outcome === "parked") {
      writtenPostId = run.body.postId ?? null;
      pass("Rejected its own draft and parked it", `${secs}s — the gate did its job`);
    } else {
      fail("Wrote a post", `outcome "${run.body?.outcome}" — ${run.body?.detail ?? "no detail"}`);
    }

    // Show why it landed where it did. A "parked" outcome is the gate
    // working, not a failure, and the reader should see the reasoning rather
    // than take the verdict on trust.
    const [verdictRow] = await sql`
      SELECT judge_verdict FROM content_plan_item
       WHERE post_id = ${writtenPostId ?? null} LIMIT 1`;
    const rounds = verdictRow?.judge_verdict?.rounds ?? [];
    if (rounds.length > 0) {
      console.log(`\n  The reviewer ran ${rounds.length} round(s):`);
      rounds.forEach((r, i) => {
        const hard = (r.gate ?? []).filter((f) => f.severity === "hard");
        const jf = r.judge?.findings ?? [];
        console.log(`    Round ${i + 1}: ${hard.length} rule failure(s), ${jf.length} reviewer note(s)`);
        for (const f of [...hard, ...jf].slice(0, 4)) {
          console.log(`      - ${f.tell}: "${String(f.quote).slice(0, 70).replace(/\n/g, " ")}…"`);
        }
      });
      if (rounds.length > 1) {
        console.log("    (More than one round means it rewrote itself. Check the rewrite");
        console.log("     genuinely fixed the problem rather than just hiding it.)");
      }
    }

    if (writtenPostId) {
      const [p] = await sql`
        SELECT status, needs_review, is_agent_generated, word_count FROM post WHERE id = ${writtenPostId}`;
  check(
    p.needs_review && p.is_agent_generated,
    "Marked as agent-written and held for review",
    "",
    JSON.stringify(p),
  );

      const [rev] = await sql`SELECT saved_by FROM post_revision WHERE post_id = ${writtenPostId} LIMIT 1`;
  check(
    rev?.saved_by === "blog-writer-agent",
    "Recorded who wrote it",
    "",
    `saved_by = ${rev?.saved_by}`,
  );
    }
  }

  // --- Report --------------------------------------------------------------
  heading("RESULT");
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.note ? `  (${r.note})` : ""}`);
  }
  console.log(`\n  ${results.length - failed.length} of ${results.length} checks passed.`);

  if (failed.length > 0) {
    console.log("\n  Do not ship. The failures above are controls, not polish.");
    process.exitCode = 1;
  } else if (writtenPostId) {
    console.log("\n  The machine is satisfied. Now the part only you can do:");
    console.log(`\n    Read it:  ${BASE}/admin/blog/posts/${writtenPostId}`);
    console.log(`    Preview:  ${BASE}/admin/blog/posts/${writtenPostId}/preview`);
    console.log("\n  To check its numbers are real (question 3), print the research it was given:");
    console.log("\n    node --env-file=.env.local scripts/uat-blog-agent.mjs --research");
    console.log("\n  Then answer the five questions in");
    console.log("  wiki/runbooks/blog-writer-agent-uat-checklist.md");
  } else {
    console.log("\n  All safety checks passed. Re-run with --write to have it write a real post,");
    console.log("  then read it and answer the five questions in the checklist.");
  }
  console.log("");
} catch (err) {
  console.error(`\n  STOPPED: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  if (sql) {
    await sql`DELETE FROM post WHERE slug IN ('uat-agent-awaiting-review','uat-human-flagged')`.catch(() => {});
    // Only the throwaway items. An item that produced a post keeps its
    // judge_verdict — that record is what the checklist asks you to read.
    await sql`DELETE FROM content_plan_item WHERE title LIKE 'UAT —%' AND post_id IS NULL`.catch(() => {});
    await sql.end();
  }
}

// --- helpers ---------------------------------------------------------------

async function seedItem() {
  const [cat] = await sql`SELECT id FROM category WHERE slug = 'data-as-a-decision-infrastructure'`;
  const [row] = await sql`
    INSERT INTO content_plan_item
      (batch_id, day_number, title, format, shape, category_id, topic, audience, action, status)
    VALUES (
      gen_random_uuid(), 1,
      'UAT — master data problem test',
      'short', 'diagnostic', ${cat?.id ?? null},
      'Master data is the set of core entities a business runs on: customers, products, suppliers. Give founders a three-question test that reveals whether inconsistent core records are costing them, and a first step that needs no engineer.',
      'Founders whose customers or products appear under different names across their CRM, invoicing and support tools, causing reports that do not reconcile.',
      'Apply the three-question test to your customer records this week.',
      'pending'
    ) RETURNING id`;
  return row.id;
}

async function makePost({ agent, review, slug }) {
  const [row] = await sql`
    INSERT INTO post (slug, title, content_md, status, scheduled_publish_at, needs_review, is_agent_generated)
    VALUES (${slug}, ${slug}, 'Body.', 'scheduled', now() - interval '1 minute', ${review}, ${agent})
    RETURNING id`;
  return row.id;
}

async function statusOf(id) {
  const [row] = await sql`SELECT status FROM post WHERE id = ${id}`;
  return row?.status ?? "(deleted)";
}
