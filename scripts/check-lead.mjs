// One-off lookup for the lead table. Used to verify W4 Pass 1 upsert
// behaviour (no duplicate rows on re-registration, is_priority sticky).
//
// Run:
//   node --env-file=.env.local scripts/check-lead.mjs <email>

import postgres from "postgres";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env.local scripts/check-lead.mjs <email>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  const rows = await sql`
    select
      id,
      email,
      first_name,
      last_name,
      job_title,
      organisation,
      phone,
      is_priority,
      created_at,
      updated_at
    from lead
    where email = ${email.toLowerCase()}
  `;

  if (rows.length === 0) {
    console.log(`No lead row for ${email}`);
  } else {
    console.log(`Found ${rows.length} row(s) for ${email}:`);
    for (const row of rows) {
      console.log(JSON.stringify(row, null, 2));
    }
  }

  const sessions = await sql`
    select
      s.id as session_id,
      s.tier,
      s.status,
      s.completed_at
    from assessment_session s
    join lead l on l.id = s.lead_id
    where l.email = ${email.toLowerCase()}
    order by s.completed_at desc nulls last
  `;
  console.log(`\nAssessment sessions for ${email}: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`  ${s.session_id} — tier=${s.tier} status=${s.status} completed_at=${s.completed_at?.toISOString?.() ?? s.completed_at}`);
  }
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
