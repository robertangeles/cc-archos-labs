// scripts/backfill-users-from-leads.mjs
//
// T2 / Phase 2 of the auth-roles port. Creates a `users` row for every
// existing `lead` row, keyed on email. This is the first step of unifying
// the two identity surfaces (see plan §5 Phase 2).
//
// Field mapping per row:
//   users.email             = lead.email
//   users.display_name      = lead.first_name + " " + lead.last_name (trimmed)
//   users.role              = 'member'   (admins keep their existing row)
//   users.is_active         = true
//   users.token_version     = 0
//   users.password_hash     = NULL       (no password set; sign-in via magic link
//                                         OR future OAuth link OR future invite flow)
//   users.email_verified_at = lead.created_at
//                              (every lead row completed the registration gate,
//                               which required a working inbox per the diagnostic
//                               flow — treat that as a verified email)
//   users.created_at        = lead.created_at  (preserve original timestamp)
//   users.updated_at        = now()
//
// The lead → user mapping is implicit via shared lower(email). Phase 4
// uses the same key to populate `assessment_session.user_id` and
// `magic_link_token.user_id`.
//
// Run:
//   node --env-file=.env.local scripts/backfill-users-from-leads.mjs            # dry run (default, safe)
//   node --env-file=.env.local scripts/backfill-users-from-leads.mjs --apply    # actually insert
//
// Re-runnable: idempotent. The script SELECTs users.email first; rows that
// already exist are SKIPped (logged but not written). Running --apply twice
// in a row should report `inserted: 0` on the second run.

import postgres from "postgres";

const apply = process.argv.includes("--apply");

const pgUrl = process.env.DATABASE_URL;
if (!pgUrl) {
  console.error("FATAL  DATABASE_URL not set in .env.local");
  process.exit(1);
}

const sql = postgres(pgUrl, { ssl: "require", max: 1 });

try {
  // Pull every lead, ordered by created_at so the report reads chronologically
  // and the inserted users keep the natural ordering.
  const leads = await sql`
    SELECT id, email, first_name, last_name, created_at
    FROM lead
    ORDER BY created_at ASC
  `;

  console.log(
    `Found ${leads.length} lead row(s). Mode: ${apply ? "APPLY" : "DRY-RUN (default; pass --apply to write)"}\n`,
  );

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of leads) {
    // Normalise to lower-case for comparison; PostgreSQL UNIQUE on
    // users.email is case-sensitive, but we want logical email matching.
    const lowerEmail = lead.email.trim().toLowerCase();

    // Does a users row already exist for this email?
    const existing = await sql`
      SELECT id, role, email_verified_at FROM users WHERE lower(email) = ${lowerEmail} LIMIT 1
    `;

    if (existing.length > 0) {
      const u = existing[0];
      skipped++;
      console.log(
        `  SKIP  ${lead.email.padEnd(45)} → user already exists (id=${u.id.slice(0, 8)}…, role=${u.role})`,
      );
      continue;
    }

    const displayName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`
      .trim()
      .slice(0, 200);

    if (!apply) {
      inserted++;
      console.log(
        `  PLAN  ${lead.email.padEnd(45)} → INSERT users(email, display_name="${displayName}", role='member', email_verified_at=${lead.created_at.toISOString().slice(0, 10)})`,
      );
      continue;
    }

    try {
      await sql`
        INSERT INTO users (
          email, display_name, role, is_active, token_version,
          email_verified_at, created_at, updated_at
        ) VALUES (
          ${lead.email},
          ${displayName || null},
          'member',
          true,
          0,
          ${lead.created_at},
          ${lead.created_at},
          now()
        )
      `;
      inserted++;
      console.log(
        `  OK    ${lead.email.padEnd(45)} → inserted (display_name="${displayName}")`,
      );
    } catch (err) {
      failed++;
      console.error(
        `  FAIL  ${lead.email.padEnd(45)} → ${err.message ?? String(err)}`,
      );
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY-RUN"}: ${inserted} ${apply ? "inserted" : "would insert"}, ${skipped} skipped (already in users), ${failed} failed.`,
  );

  if (!apply && inserted > 0) {
    console.log(
      `\nReview above. To execute: re-run with --apply.`,
    );
  }
} finally {
  await sql.end();
}
