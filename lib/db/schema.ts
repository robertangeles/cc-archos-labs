import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  boolean,
  integer,
  numeric,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// All tables follow CLAUDE.md Database Design Standards: snake_case
// singular, UUID PK, created_at + updated_at on every row, every FK
// indexed, 2NF strict. JSONB columns are permitted under CLAUDE.md's
// exception for audit/metadata payloads — application layer validates
// shape (Zod) rather than the DB.

// ============================================================================
// site_setting — Phase 1.C admin
// ============================================================================
// Site-wide brand / SEO config. Single key-value table; one row per
// logical setting blob (e.g. key='site' holds the SEO/brand config).

export const siteSetting = pgTable("site_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Logical name for this row (e.g. 'site', 'profile', 'contact_form').
  // Upserts target this column.
  key: text("key").notNull().unique(),
  // The actual settings as a JSON document. Application layer validates shape.
  value: jsonb("value").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SiteSetting = typeof siteSetting.$inferSelect;
export type NewSiteSetting = typeof siteSetting.$inferInsert;

// ============================================================================
// lead — Phase 2 AI Readiness Assessment
// ============================================================================
// One row per registered email — the account holder who completed the
// registration gate after the diagnostic. A returning user with the same
// email reuses this row; the assessment_session table holds each pass.

export const lead = pgTable("lead", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Email is the natural identity for an account holder. Unique enforces
  // one lead per email; the registration flow upserts on this column.
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jobTitle: text("job_title"),
  organisation: text("organisation"),
  phone: text("phone"),
  // Set true when the latest session's urgency_flag = 'mandate' (per
  // spec §5.2). CRM webhook tags the row downstream.
  isPriority: boolean("is_priority").notNull().default(false),
  // Timestamp of last successful CRM webhook write. NULL means we have
  // not yet synced this row to the CRM destination.
  crmSyncedAt: timestamp("crm_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Lead = typeof lead.$inferSelect;
export type NewLead = typeof lead.$inferInsert;

// ============================================================================
// assessment_session — Phase 2
// ============================================================================
// One row per pass through the diagnostic. lead_id is nullable because a
// session begins before the registration gate fires — first answers go
// in anonymously, then the row is linked to a lead when the user
// registers. Status transitions: in_progress -> completed | abandoned.

export const assessmentSession = pgTable(
  "assessment_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => lead.id, {
      onDelete: "set null",
    }),
    // 'in_progress' | 'completed' | 'abandoned'. Drives the
    // return-visitor portal logic (W5) and analytics queries.
    status: text("status").notNull().default("in_progress"),
    // { questionId: answerCode } e.g. { q1: 'B', q6: 'C', q6a: 'A' }.
    // Includes branch-question answers when triggered.
    answers: jsonb("answers").notNull().default({}),
    // { dataFoundation: number, programReadiness: number,
    //   orgReality: number, total: number }. Populated by the scoring
    // engine (W2) after the session completes.
    scores: jsonb("scores"),
    // 'Critical' | 'Emerging' | 'Developing' | 'Advanced'. Derived from
    // total score per the tier boundaries in lib/diagnostic/content.ts.
    tier: text("tier"),
    // [{ code: string, severity: 'critical' | 'high' | 'medium',
    //    title: string }]. Up to 3 per session per spec §5.3.
    riskFlags: jsonb("risk_flags"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // FK lookup: list a lead's previous sessions (return-visitor portal,
    // admin "view this user's history" query).
    leadIdx: index("assessment_session_lead_id_idx").on(table.leadId),
    // Status filter: count of completed/abandoned for the analytics
    // dashboard. Low cardinality so partial-index could replace this
    // later if the table gets big.
    statusIdx: index("assessment_session_status_idx").on(table.status),
  }),
);

export type AssessmentSession = typeof assessmentSession.$inferSelect;
export type NewAssessmentSession = typeof assessmentSession.$inferInsert;

// ============================================================================
// report_output — Phase 2
// ============================================================================
// The Claude-generated practitioner narrative, one row per session
// (unique on assessment_session_id). Holds verdict + narrative +
// action_plan plus model/prompt/token metadata for cost tracking and
// reproducibility. CASCADE delete: if a session is purged the report
// goes with it.

export const reportOutput = pgTable("report_output", {
  id: uuid("id").primaryKey().defaultRandom(),
  // unique() ensures one report per session — retake-flow (W5) creates
  // a new session, not a new report on the same session.
  assessmentSessionId: uuid("assessment_session_id")
    .notNull()
    .unique()
    .references(() => assessmentSession.id, { onDelete: "cascade" }),
  // One-sentence verdict from Claude (per spec §6.1).
  verdict: text("verdict").notNull(),
  // 400–500 word practitioner narrative (spec §6.3).
  narrative: text("narrative").notNull(),
  // [{ title: string, time_horizon: '0-30d' | '30-90d' | '90d+',
  //    body: string }]. 3–5 actions per spec §6.4.
  actionPlan: jsonb("action_plan").notNull(),
  // 'claude-sonnet-4-6' etc. Stored for observability — when prompts
  // change behaviour, we can correlate by model version.
  modelId: text("model_id").notNull(),
  // 'v1', 'v2', etc. Bump when the system prompt structure changes.
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReportOutput = typeof reportOutput.$inferSelect;
export type NewReportOutput = typeof reportOutput.$inferInsert;

// ============================================================================
// magic_link_token — Phase 2 W4 Pass 2
// ============================================================================
// One row per sign-in link issued for a returning lead. Raw token never
// stored — we hash with sha256 and only the digest is persisted. The
// link in the email carries the raw token; the verify endpoint hashes
// the incoming token and looks up the row.
//
// Lifecycle:
//   created → consumed (single use, `consumed_at` set)
//             OR expired (`expires_at` passes; row stays for audit then
//             swept later)
//
// CASCADE delete on lead_id so removing a lead cleans up their tokens.

export const magicLinkToken = pgTable(
  "magic_link_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    // sha256 hex of the raw token. unique() so a colliding hash (any
    // shape) is treated as a write conflict, not a duplicate row.
    tokenHash: text("token_hash").notNull().unique(),
    // now() + 15 minutes at mint time. The verify endpoint refuses
    // tokens past their expiry regardless of consumed_at.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set on first successful verify. Replay returns expired.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // FK lookup: list a lead's recent links (rate-limit decisions, audit).
    leadIdx: index("magic_link_token_lead_id_idx").on(table.leadId),
  }),
);

export type MagicLinkToken = typeof magicLinkToken.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkToken.$inferInsert;

// ============================================================================
// share_token — Phase 2 C-2 (shareable report URLs)
// ============================================================================
// Lets a lead generate a public URL for a specific report so they can
// forward it to a CFO / board / collaborator without that recipient
// having to register or sign in. Raw token never stored — we hash with
// sha256 and only the digest is persisted. The link in the share URL
// carries the raw token.
//
// Properties (locked in 2026-05-13 user decision):
//   - 7-day TTL from mint time.
//   - "One consume, re-views OK" — consumed_at is stamped on first
//     view for audit, but subsequent visits still render until
//     expires_at OR revoked_at fires.
//   - Many active tokens per report supported — owner can mint
//     independent links for different recipients, each revocable.
//
// CASCADE delete on assessment_session_id so removing a session
// cleans up its tokens.

export const shareToken = pgTable(
  "share_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentSessionId: uuid("assessment_session_id")
      .notNull()
      .references(() => assessmentSession.id, { onDelete: "cascade" }),
    // sha256 hex of the raw token. unique() so any hash collision
    // (vanishingly rare) is treated as a write conflict.
    tokenHash: text("token_hash").notNull().unique(),
    // now() + 7 days at mint time. Verify refuses past expiry.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Stamped on first successful view. Subsequent views still render
    // until expires_at OR revoked_at — see the discussion above.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    // Set when the owner clicks "Revoke" on a token. Verify treats
    // revoked tokens as not-found.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // FK lookup: list tokens for a report (owner UI), or cascade
    // cleanup when a session is purged.
    sessionIdx: index("share_token_assessment_session_id_idx").on(
      table.assessmentSessionId,
    ),
  }),
);

export type ShareToken = typeof shareToken.$inferSelect;
export type NewShareToken = typeof shareToken.$inferInsert;

// ============================================================================
// integration_secret_audit — Phase 2.5 integration-config rotation log
// ============================================================================
// Audit trail for the /admin/integrations Settings page. One row per admin
// mutation of an integration secret or config value. Captures key_name +
// operation + actor + timestamp. Crucially, NEVER stores the value itself
// — that would defeat encryption-at-rest. Reads from this table answer
// "who changed which secret, when?" for incident reconstruction.
//
// No updated_at column: audit rows are immutable. Append-only by contract.

export const integrationSecretAudit = pgTable(
  "integration_secret_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Field name in the IntegrationConfig (e.g. 'resend_api_key',
    // 'admin_password', 'contact_recipient_email'). Snake-case to match
    // the DB convention; the loader translates to camelCase types.
    keyName: text("key_name").notNull(),
    // One of: 'created' (first migration), 'updated' (admin edit),
    // 'revealed' (admin viewed plaintext), 'rotated_master_key'
    // (the master-key UI flow re-encrypted this field).
    operation: text("operation").notNull(),
    // The admin identity that performed the action. Admin auth today is
    // password-only with no user record, so this is the literal 'admin'.
    // When multi-admin lands, becomes a FK to admin_user.id.
    actor: text("actor").notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Serves: "show change history for this secret" admin views.
    index("integration_secret_audit_key_name_idx").on(table.keyName),
    // Serves: "show all recent mutations across all keys" reverse-chrono view.
    index("integration_secret_audit_created_at_idx").on(table.createdAt),
  ],
);

export type IntegrationSecretAudit = typeof integrationSecretAudit.$inferSelect;
export type NewIntegrationSecretAudit = typeof integrationSecretAudit.$inferInsert;

// ============================================================================
// Relations — for typed Drizzle joins (db.query.assessmentSession.findFirst({ with: { lead } }))
// ============================================================================

export const leadRelations = relations(lead, ({ many }) => ({
  sessions: many(assessmentSession),
  magicLinkTokens: many(magicLinkToken),
}));

export const magicLinkTokenRelations = relations(magicLinkToken, ({ one }) => ({
  lead: one(lead, {
    fields: [magicLinkToken.leadId],
    references: [lead.id],
  }),
}));

export const assessmentSessionRelations = relations(
  assessmentSession,
  ({ one }) => ({
    lead: one(lead, {
      fields: [assessmentSession.leadId],
      references: [lead.id],
    }),
    report: one(reportOutput, {
      fields: [assessmentSession.id],
      references: [reportOutput.assessmentSessionId],
    }),
  }),
);

export const reportOutputRelations = relations(reportOutput, ({ one }) => ({
  session: one(assessmentSession, {
    fields: [reportOutput.assessmentSessionId],
    references: [assessmentSession.id],
  }),
}));

// ============================================================================
// consultant — Book-a-Call
// ============================================================================
// One row per person who takes calls. v1 hardcodes to a single consultant
// (Rob), but the schema is multi-consultant ready (D5b). Holds the
// per-consultant config that the slot generator and email pipeline read
// from: working hours, timezone, blackouts (via FK), Google OAuth refresh
// token (encrypted via AES-GCM, see lib/booking-crypto.ts).

export const consultant = pgTable("consultant", {
  id: uuid("id").primaryKey().defaultRandom(),
  // URL slug for the public booking page (/book/[slug]). Lower-case
  // kebab-case, must be unique. Used in OG cards, copy/paste shareable
  // links, and the magic-link manage URLs. Single source of truth for
  // "which consultant does this booking belong to" in the public flow.
  slug: text("slug").notNull().unique(),
  // Sender display name on emails (e.g. "Rob at Archos Labs").
  displayName: text("display_name").notNull(),
  // Sender email + alert routing destination. Unique per consultant.
  email: text("email").notNull().unique(),
  // IANA tz string (e.g. 'Australia/Sydney'). Slot generation is
  // anchored to this tz; the prospect's tz is captured separately on
  // each booking. Default is UTC — a placeholder admin must overwrite
  // via the profile UI to match where they actually take calls.
  // Migration 0007 removed an earlier arbitrary 'Asia/Manila' default.
  timezone: text("timezone").notNull().default("UTC"),
  // Slot length and buffer between bookings, both in minutes.
  slotMinutes: integer("slot_minutes").notNull().default(30),
  slotBufferMinutes: integer("slot_buffer_minutes").notNull().default(15),
  // How far ahead bookings are allowed.
  advanceDays: integer("advance_days").notNull().default(14),
  // How close to "now" bookings are allowed.
  minNoticeHours: integer("min_notice_hours").notNull().default(24),
  // {"mon": [9, 17], "tue": [9, 17], ...} — start/end hour pairs per
  // weekday. Missing day = unavailable. Application validates shape (Zod).
  workingHoursJson: jsonb("working_hours_json").notNull().default({}),
  // AES-GCM ciphertext of the Google refresh token (D6a). NULL until Rob
  // completes the /admin/connect-google OAuth grant. See
  // lib/booking-crypto.ts for the encryption helper.
  googleRefreshTokenEncrypted: text("google_refresh_token_encrypted"),
  // Usually 'primary' — Rob's main Google calendar. NULL until OAuth done.
  googleCalendarId: text("google_calendar_id"),
  // 'pending' | 'ok' | 'stale'. Flipped to 'stale' when refresh fails;
  // emits an alert to the consultant's email and disables new bookings.
  googleStatus: text("google_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Consultant = typeof consultant.$inferSelect;
export type NewConsultant = typeof consultant.$inferInsert;

// ============================================================================
// consultant_blackout — Book-a-Call
// ============================================================================
// Date ranges where a consultant is unavailable regardless of
// working_hours_json. Vacation, focus weeks, conference travel. The slot
// generator subtracts these from the candidate slot list.

export const consultantBlackout = pgTable(
  "consultant_blackout",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consultantId: uuid("consultant_id")
      .notNull()
      .references(() => consultant.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    // Free-text label shown in admin UI ("Conference", "Vacation").
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Composite index serves the slot-generator query:
    // "blackouts for consultant X overlapping date range Y..Z".
    consultantStartIdx: index("consultant_blackout_consultant_id_start_at_idx")
      .on(table.consultantId, table.startAt),
  }),
);

export type ConsultantBlackout = typeof consultantBlackout.$inferSelect;
export type NewConsultantBlackout = typeof consultantBlackout.$inferInsert;

// ============================================================================
// booking_request — Book-a-Call
// ============================================================================
// One row per booking attempt that landed (validation passed, slot
// reserved). status transitions: confirmed -> (cancelled | rescheduled_from
// | completed | no_show). pending_calendar_sync is a transient state for
// bookings where Google Calendar event creation failed and async retry is
// queued. All timestamps stored UTC; prospect_timezone is preserved for
// email rendering and audit.

export const bookingRequest = pgTable(
  "booking_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consultantId: uuid("consultant_id")
      .notNull()
      .references(() => consultant.id),
    // Prospect identity. NOT unique on email — same prospect may book
    // multiple times across the year. Idempotency is enforced via the
    // idempotency_key column instead.
    name: text("name").notNull(),
    email: text("email").notNull(),
    organisation: text("organisation"),
    position: text("position"),
    // Free-text "why are you booking" answer the prospect typed first.
    reasonInitial: text("reason_initial").notNull(),
    // [{question: string, answer: string}] — Claude's 2-turn follow-up
    // (D4a). Empty array if conversational intake fell back to static.
    reasonFollowups: jsonb("reason_followups").notNull().default([]),
    // UTC. Application converts to prospect_timezone for rendering.
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    slotEnd: timestamp("slot_end", { withTimezone: true }).notNull(),
    // IANA tz the prospect saw when picking the slot. Used to render
    // emails in their tz, and for analytics.
    prospectTimezone: text("prospect_timezone").notNull(),
    // confirmed | cancelled | completed | no_show | rescheduled_from |
    // pending_calendar_sync. State machine documented in plan §5.3.
    status: text("status").notNull().default("confirmed"),
    // Google Calendar event id + Meet link. NULL during the
    // pending_calendar_sync window before async retry succeeds.
    googleEventId: text("google_event_id"),
    meetUrl: text("meet_url"),
    // UTM + referrer captured from the URL at booking time (D4c).
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    referrer: text("referrer"),
    // Any other attribution fields the marketing team adds later (gclid,
    // fbclid, etc.). Schema-flexible escape hatch.
    attributionExtras: jsonb("attribution_extras").notNull().default({}),
    // JWT IDs for the cancel + reschedule magic links. We store the jti
    // so single-use enforcement can revoke them on consume.
    rescheduleJti: text("reschedule_jti"),
    cancelJti: text("cancel_jti"),
    // Timestamps marking when each pipeline email fired. NULL = not yet.
    // The cron job uses these to dedupe and to avoid sending late
    // reminders for bookings made < N hours before the slot.
    precallBriefSentAt: timestamp("precall_brief_sent_at", {
      withTimezone: true,
    }),
    reminder24hSentAt: timestamp("reminder_24h_sent_at", {
      withTimezone: true,
    }),
    reminder1hSentAt: timestamp("reminder_1h_sent_at", { withTimezone: true }),
    postcallFollowupSentAt: timestamp("postcall_followup_sent_at", {
      withTimezone: true,
    }),
    noshowRecoverySentAt: timestamp("noshow_recovery_sent_at", {
      withTimezone: true,
    }),
    // Self-FK for reschedule chains: when this booking is rescheduled,
    // status becomes 'rescheduled_from' and this column points to the new
    // booking_request row. NULL on the current/live booking.
    rescheduledToId: uuid("rescheduled_to_id").references(
      (): AnyPgColumn => bookingRequest.id,
      { onDelete: "set null" },
    ),
    // Hash of (email + slot_start + 5-min bucket). Server checks this
    // before insert to dedupe rapid double-submits. UNIQUE constraint
    // makes the dedup race-safe — DB rejects the duplicate insert.
    // Dedup only matches rows where status='confirmed' (see route logic);
    // a cancelled booking shouldn't block a legitimate rebook.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    // Running total of Claude API spend attributable to this booking
    // (conversational intake + pre-call brief + blog matching). Summed
    // monthly for the budget alert at 80% / 100% of cap.
    claudeCostUsdTotal: numeric("claude_cost_usd_total", {
      precision: 10,
      scale: 6,
    })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Primary query: "all bookings for consultant X around date Y" —
    // used by the slot generator's conflict check and admin list view.
    consultantSlotIdx: index("booking_request_consultant_id_slot_start_idx")
      .on(table.consultantId, table.slotStart),
    // Admin / analytics: "find all bookings by this email".
    emailIdx: index("booking_request_email_idx").on(table.email),
    // Admin list filter: "all upcoming confirmed" / "all no-show".
    statusIdx: index("booking_request_status_idx").on(table.status),
  }),
);

export type BookingRequest = typeof bookingRequest.$inferSelect;
export type NewBookingRequest = typeof bookingRequest.$inferInsert;

// ============================================================================
// scheduled_job — Book-a-Call
// ============================================================================
// Outbox queue for every email this system fires after booking creation.
// confirmation goes here too (D18) so a Resend hiccup at booking time is
// transparently retried. The cron handler at /api/cron/process-scheduled
// dequeues with FOR UPDATE SKIP LOCKED (D19) to prevent overlapping runs
// from double-sending. Status transitions: pending -> processing ->
// (sent | failed). Jobs that fail attempts_max times land status='failed'
// and emit an [ALERT] email to the consultant.

export const scheduledJob = pgTable(
  "scheduled_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // confirmation | reminder_24h | reminder_1h | precall_brief |
    // postcall_followup | noshow_recovery. Each maps to a Resend template
    // and a generator function (some need Claude, some are static).
    kind: text("kind").notNull(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookingRequest.id, { onDelete: "cascade" }),
    // UTC. Cron picks up rows where status='pending' AND due_at <= now().
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    // pending | processing | sent | failed | skipped. 'skipped' is for
    // jobs that became irrelevant (e.g. 1h reminder for a booking made
    // 30 min before slot — no time to send).
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lastError: text("last_error"),
    // Cron run id holding the lock + safety expiry. With FOR UPDATE SKIP
    // LOCKED the row-level lock auto-releases on tx commit, but these
    // fields give observability and let a stale-lock sweeper recover from
    // mid-run crashes (P2 TODO from eng review §18.8).
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    // Per-job Claude API spend (NULL for pure email jobs that don't call
    // Claude). Summed into booking_request.claude_cost_usd_total.
    claudeCostUsd: numeric("claude_cost_usd", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Cron poller's primary query — "give me pending jobs whose due_at
    // has passed". Covers the FOR UPDATE SKIP LOCKED dequeue.
    statusDueIdx: index("scheduled_job_status_due_at_idx").on(
      table.status,
      table.dueAt,
    ),
    // FK index — required by CLAUDE.md DB standards.
    bookingIdx: index("scheduled_job_booking_id_idx").on(table.bookingId),
  }),
);

export type ScheduledJob = typeof scheduledJob.$inferSelect;
export type NewScheduledJob = typeof scheduledJob.$inferInsert;

// ============================================================================
// cron_heartbeat — Book-a-Call
// ============================================================================
// Single row, updated on every successful cron run. /api/health/cron
// reads last_run_at and returns it as JSON; UptimeRobot pings the route
// every 5 min and alerts if the value goes stale (>10 min). The PK is
// the literal string 'singleton' to make accidental multi-row inserts a
// constraint violation rather than silent data corruption.

export const cronHeartbeat = pgTable("cron_heartbeat", {
  id: text("id").primaryKey(), // always 'singleton'
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
  lastRunJobsProcessed: integer("last_run_jobs_processed")
    .notNull()
    .default(0),
  lastRunJobsFailed: integer("last_run_jobs_failed").notNull().default(0),
  // Run duration is useful for the "cron overflow" metric in §18.6 —
  // when this approaches 5 min we either chunk batches harder or bump
  // cron frequency.
  lastRunDurationMs: integer("last_run_duration_ms"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CronHeartbeat = typeof cronHeartbeat.$inferSelect;
export type NewCronHeartbeat = typeof cronHeartbeat.$inferInsert;

// ============================================================================
// Relations — Book-a-Call
// ============================================================================

export const consultantRelations = relations(consultant, ({ many }) => ({
  bookings: many(bookingRequest),
  blackouts: many(consultantBlackout),
}));

export const consultantBlackoutRelations = relations(
  consultantBlackout,
  ({ one }) => ({
    consultant: one(consultant, {
      fields: [consultantBlackout.consultantId],
      references: [consultant.id],
    }),
  }),
);

export const bookingRequestRelations = relations(
  bookingRequest,
  ({ one, many }) => ({
    consultant: one(consultant, {
      fields: [bookingRequest.consultantId],
      references: [consultant.id],
    }),
    scheduledJobs: many(scheduledJob),
    rescheduledTo: one(bookingRequest, {
      fields: [bookingRequest.rescheduledToId],
      references: [bookingRequest.id],
      relationName: "reschedule_chain",
    }),
  }),
);

export const scheduledJobRelations = relations(scheduledJob, ({ one }) => ({
  booking: one(bookingRequest, {
    fields: [scheduledJob.bookingId],
    references: [bookingRequest.id],
  }),
}));
