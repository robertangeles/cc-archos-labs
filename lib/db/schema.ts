import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  uuid,
  boolean,
  integer,
  numeric,
  vector,
  index,
  unique,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

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
    // Site-wide account owner. New sessions (post-Phase B) write this;
    // legacy lead-owned sessions have user_id = NULL.
    userId: uuid("user_id").references(() => users.id, {
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
    userIdx: index("assessment_session_user_id_idx").on(table.userId),
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

/**
 * Shape of report_output.recommended_readings JSONB column.
 *
 * Each entry pairs a Translation Layer post with the action_plan item
 * it supports, plus a one-sentence "why this matters to your situation"
 * gloss. Persisted at report-generation time so the shareable artefact
 * is deterministic across re-opens (D7: never refresh).
 *
 * actionIndex semantics:
 *   - 0..N-1 → the post supports action_plan[actionIndex]
 *   - -1     → per-report fallback (verdict + narrative ANN), surfaced
 *              only when no individual action returned a result above
 *              the similarity threshold
 *
 * gloss may be empty string when the gloss LLM call degraded (per the
 * fail-soft path in lib/posts/gloss.ts) — UI renders the post without
 * the relevance note rather than hiding the recommendation entirely.
 */
export interface RecommendedReading {
  actionIndex: number;
  postId: string;
  gloss: string;
}

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
  // JSONB exception per CLAUDE.md Database Design §1: structured
  // metadata column with documented shape (RecommendedReading[] above).
  // Nullable for backward compatibility with reports generated before
  // PR1 landed — render layer treats NULL as "no readings block".
  // Populated at report-generation time only (D7: never refresh).
  recommendedReadings: jsonb("recommended_readings").$type<
    RecommendedReading[]
  >(),
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
    leadId: uuid("lead_id").references(() => lead.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
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
    userIdx: index("magic_link_token_user_id_idx").on(table.userId),
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
  user: one(users, {
    fields: [magicLinkToken.userId],
    references: [users.id],
  }),
}));

export const assessmentSessionRelations = relations(
  assessmentSession,
  ({ one }) => ({
    lead: one(lead, {
      fields: [assessmentSession.leadId],
      references: [lead.id],
    }),
    user: one(users, {
      fields: [assessmentSession.userId],
      references: [users.id],
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
  // Internal routing email — used as the consultant's identity for
  // OAuth lookups and as the From: header on outgoing booking emails.
  // Unique per consultant. NOT necessarily the same as what's surfaced
  // publicly on the booking page; that's `public_email` below.
  email: text("email").notNull().unique(),
  // Public-facing email shown on the booking page's escape-hatch
  // ("Times don't suit? Email …"). NULL means fall back to `email`.
  // Lets an admin route internal notifications to an aliased inbox
  // (e.g. trebor.selegna@outlook.com) while showing prospects a
  // branded address (rob.angeles@archoslabs.xyz).
  publicEmail: text("public_email"),
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

// ============================================================================
// page — Pages CMS Phase 1
// ============================================================================
// WordPress-style Pages CMS. Each row is a publishable long-form page
// (Privacy, Terms, future marketing pages). Content is markdown only —
// the renderer (components/pages/markdown-article.tsx) uses react-markdown
// with remark-gfm + NO rehype-raw (XSS posture). Phases 2-6 will add
// section blocks, hierarchy, audience variants, redirects, etc. — none of
// those columns are on this table yet (see
// wiki/decisions/2026-05-18-pages-cms-expansion.md).
//
// Lifecycle:
//
//   draft ───publish──▶ published ───archive──▶ archived
//     ▲                     │                       │
//     │                     ▼                       │
//     └─── unpublish ◀───── │ ◀── restore ──────────┘
//
// Soft-delete only: archived_at NOT NULL means archived. Public surfaces
// filter on `status='published' AND archived_at IS NULL`. The catch-all
// at app/[...slug]/page.tsx is the sole reader for public traffic.

export const page = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // URL slug, kebab-case, no leading slash. Reserved-slug guard runs at
    // three layers (Zod refinement, lib/pages/reserved-slugs, boot
    // assertion) so the CMS can never shadow an existing app/* route.
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    // Markdown source of truth. Capped at 200KB at the API layer (Zod
    // .max). No HTML allowed — react-markdown default config strips it.
    contentMd: text("content_md").notNull().default(""),
    // 1-2 sentence summary. Used as og:description fallback when
    // seo_description is null.
    excerpt: text("excerpt"),
    // Per-page overrides for SEO. NULL = fall back to title / excerpt.
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // 'long_form' (markdown body in content_md, rendered via
    // MarkdownArticle) OR 'composed' (page_block rows, rendered via
    // BlocksRenderer). Mutually exclusive at render time. Switching
    // template doesn't migrate content either direction — content_md
    // stays put for long_form, page_block rows stay put for composed.
    template: text("template").notNull().default("long_form"),
    // 'draft' | 'published' | 'archived'. Status transitions only via
    // savePage / archivePage / restorePage — never written directly.
    status: text("status").notNull().default("draft"),
    // 'article' (default for legal/long-form) | 'website' (landing pages).
    ogType: text("og_type").notNull().default("article"),
    // First-publish timestamp. NULL until first publish; preserved across
    // republishes (only set once).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // "Last reviewed" stamp separate from updated_at. Privacy/Terms
    // convention — content may not change but the policy was reviewed.
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    // Soft-delete. archived_at NOT NULL hides the page from public
    // surfaces but preserves it (and its revisions) for restore.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Public catch-all hot path: SELECT ... WHERE slug = $1 AND
    // status = 'published' AND archived_at IS NULL.
    // slug is already UNIQUE indexed via .unique(); this composite
    // partial index serves admin "list published" listings.
    index("page_status_published_at_idx")
      .on(table.status, table.publishedAt),
    // Admin archive view: WHERE archived_at IS NOT NULL.
    index("page_archived_at_idx").on(table.archivedAt),
  ],
);

export type Page = typeof page.$inferSelect;
export type NewPage = typeof page.$inferInsert;

// ============================================================================
// page_revision — Pages CMS Phase 1
// ============================================================================
// Immutable audit trail. One row per admin save, including the initial
// create. Captures title + content_md + seo_* at the point of save —
// every legal-copy edit is reconstructable from this table. Same
// posture as integration_secret_audit (append-only, actor + timestamp,
// no updated_at). diff_size_pct quantifies the delta from the prior
// revision so the admin UI can surface "material change" banners
// (Privacy §12 promise — Phase 5 will email leads on material change).
//
// CASCADE delete on page_id: revisions vanish only when the page row
// itself is hard-deleted (which only happens via direct DB tooling,
// never via the admin UI — admin uses soft-delete via archived_at).

export const pageRevision = pgTable(
  "page_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // 0-100. Percentage change in content_md vs the prior revision.
    // First revision (create) is always 100.00. Computed at the API
    // layer via a simple length-delta heuristic — exact Levenshtein
    // is overkill for the "is this a material change?" signal.
    diffSizePct: numeric("diff_size_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    // Phase 2: snapshot of page_block rows at save time when the page is
    // template='composed'. Shape: [{ id, block_type, position, props }].
    // NULL when template='long_form' (the content lives in content_md).
    // Capturing the snapshot here rather than versioning page_block
    // separately keeps Phase 2 audit cheap: one row per save covers both
    // markdown and composed templates uniformly.
    blocksSnapshot: jsonb("blocks_snapshot"),
    // The admin identity that performed the save. Single-admin model
    // today; matches integration_secret_audit.actor shape so multi-admin
    // can land later as a FK without rewriting this column.
    savedBy: text("saved_by").notNull().default("admin"),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary query: "show revisions for this page, newest first."
    // Admin revision-history view + restore flow.
    index("page_revision_page_id_saved_at_idx").on(
      table.pageId,
      table.savedAt,
    ),
  ],
);

export type PageRevision = typeof pageRevision.$inferSelect;
export type NewPageRevision = typeof pageRevision.$inferInsert;

// ============================================================================
// page_block — Pages CMS Phase 2 (composed pages)
// ============================================================================
// One row per block in a composed page. The `block_type` is a string key
// into lib/pages/blocks/registry.ts which maps to:
//   - React component (section component wrapper)
//   - Zod schema for the props payload
//   - default props for the block-picker UI
//
// `props` is jsonb validated against the Zod schema at admin save AND at
// render. Render-time validation falls back to a placeholder ("[invalid
// block — admin needs to fix]") so one bad block doesn't kill the page.
//
// `position` is a 0-based ordinal within the page. Reordering rewrites
// the position values on every block in the page (small N — <50 blocks
// per page in any realistic case — so this is cheaper than a sparse-
// integer scheme or a linked-list).
//
// CASCADE delete on page_id: deleting a page (hard delete via DB tooling)
// removes all blocks. Soft delete via page.archived_at preserves them.
//
// transclude_id (reusable blocks) deferred to Phase 6 — adding the column
// only when the feature ships, per CLAUDE.md "no abstractions for
// single-use code."

export const pageBlock = pgTable(
  "page_block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    // Registry key, e.g. 'hero' | 'cta_pair' | 'service_card' | …
    // Validated against the registry at save + render; unknown types
    // are rejected at save and rendered as a placeholder at render.
    blockType: text("block_type").notNull(),
    // 0-based ordinal within the page. UNIQUE(page_id, position) keeps
    // ordering deterministic; reordering rewrites positions in one tx.
    position: integer("position").notNull(),
    // Block-specific props. Validated against the Zod schema for
    // `block_type` at both save and render.
    props: jsonb("props").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary read: "all blocks for this page in render order."
    index("page_block_page_id_position_idx").on(
      table.pageId,
      table.position,
    ),
  ],
);

export type PageBlock = typeof pageBlock.$inferSelect;
export type NewPageBlock = typeof pageBlock.$inferInsert;

// ============================================================================
// Relations — Pages CMS
// ============================================================================

export const pageRelations = relations(page, ({ many }) => ({
  revisions: many(pageRevision),
  blocks: many(pageBlock),
}));

export const pageRevisionRelations = relations(pageRevision, ({ one }) => ({
  page: one(page, {
    fields: [pageRevision.pageId],
    references: [page.id],
  }),
}));

export const pageBlockRelations = relations(pageBlock, ({ one }) => ({
  page: one(page, {
    fields: [pageBlock.pageId],
    references: [page.id],
  }),
}));

// ============================================================================
// author — Translation Layer (rosy-bee)
// ============================================================================
// Editorial author of a `post`. Single-author today (Rob), but schema is
// multi-author from day one so future contributors land without migration.
// Public surfaces (post page byline, JSON-LD Person schema) read from
// this row — never from a hardcoded constant.
//
// `slug` is reserved for future per-author archive pages (Phase 4+);
// rendering today reads `name` + `bio_md` + `linkedin_url` + `photo_url`.

export const author = pgTable("author", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Short markdown bio shown at the end of every post via the existing
  // PersonCard component.
  bioMd: text("bio_md").notNull().default(""),
  // Square avatar URL. Stored as a full URL so it can point at R2/CDN
  // without further normalisation.
  photoUrl: text("photo_url"),
  // Used as `sameAs` in JSON-LD Person schema for entity recognition.
  linkedinUrl: text("linkedin_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Author = typeof author.$inferSelect;
export type NewAuthor = typeof author.$inferInsert;

// ============================================================================
// category — Translation Layer (rosy-bee)
// ============================================================================
// Editorial taxonomy. Migrated from robertangeles.com Yoast categories.
// One-to-many with `post` — a post has exactly one category (matches the
// WordPress source shape; tags are free-form JSONB on `post.tags`).
//
// Seed data lands at migration time: AI as Strategy, Data as a Decision
// Infrastructure, Human-Centered Transformation, The Execution Layer.
// Category names display verbatim on /blog/[slug] eyebrow + /blog/category/[slug].

export const category = pgTable("category", {
  id: uuid("id").primaryKey().defaultRandom(),
  // URL-safe slug for /blog/category/[slug]. Reserved-slug guard runs
  // separately in lib/posts.
  slug: text("slug").notNull().unique(),
  // Human-readable label shown in UI (eyebrow row, category index header).
  name: text("name").notNull(),
  // Optional one-line description shown on the category index page.
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;

// ============================================================================
// post — Translation Layer (rosy-bee)
// ============================================================================
// Time-stamped editorial published under /blog (brand: "The Translation
// Layer"). Sibling of `page` — NOT a subtype. Page = static marketing
// pages; Post = editorial with date, author, category, semantic embedding,
// reading-time, last-reviewed stamp.
//
// Migrated from robertangeles.com WordPress (~200 posts). Future posts
// authored directly via the admin /admin/(authed)/posts UI (Phase 3 of
// the CMS expansion adds AI-assisted authoring on top of this table).
//
// Lifecycle:
//
//   draft ──schedule──▶ scheduled ──auto-publish (cron)──▶ published
//     │                                                       │
//     └──────────────────publish────────────────────────────▶ │
//                                                              │
//                                                              ▼
//                                                          archive ──▶ archived
//                                                              ▲           │
//                                                              └─restore───┘
//
// Visibility (independent of status):
//   listed   → appears in /blog index, sitemap-prominent, read-next pool
//   unlisted → indexable via direct URL only (SEO equity preserved,
//              editorially hidden from index + read-next + sitemap-prominent)
//
// Soft delete via `archived_at` (mirrors `page` pattern). Public reader:
//   WHERE status='published' AND visibility='listed' AND archived_at IS NULL
// Direct-URL reader (e.g. 301 from old robertangeles permalink):
//   WHERE status='published' AND archived_at IS NULL  -- visibility ignored
//
// `embedding` is a 1024-dim vector from Voyage AI voyage-3-large (set at
// migration time + every admin save). Powers the read-next widget and
// /search ANN queries. The HNSW index `post_embedding_hnsw_idx` is created
// in custom SQL (Drizzle has no HNSW builder yet); see the migration file.
//
// `source_wp_id` is the WordPress uhiz_posts.ID — used as the upsert key
// during the migration script so re-runs are idempotent. NULL for posts
// authored directly in admin.
//
// `needs_review` is the Claude polish quality flag (Phase 3 AI authoring
// reuses the same column for "this draft needs human review before publish").
//
// `og_image_*` columns expanded in migration 0016 to capture full image
// metadata (alt, dimensions, mime, size, uploader, checksum, R2 key,
// soft-delete) — required for accessibility (WCAG alt text), CLS
// prevention (width/height), and orphaned-file cleanup (R2 key registry).

// ============================================================================
// users — canonical account model (Phase 1 of auth-roles port)
// ============================================================================
// Originally migration 0015 introduced this as a placeholder for `saved_by`
// / `uploaded_by` FK targets. Phase 1 of the auth-roles port extends it
// into the canonical account model that powers BOTH admin sessions AND
// public diagnostic-taker accounts (the latter migrate in from `lead` in
// Phase 5 — see plan §5).
//
// Auth pattern (per plan E1 — hybrid JWT + DB session):
//   - `password_hash` nullable; OAuth-only users have NULL.
//   - `email_verified_at` set at first magic-link click OR first OAuth login.
//   - `is_active` soft-disables an account without deletion (preserves FK
//     pointers from `post.og_image_uploaded_by` etc.).
//   - `token_version` is bumped on password reset / admin force-logout.
//     Every issued JWT carries the value at mint time; verify rejects on
//     mismatch without a DB lookup. Edge-safe global-revocation hook.
//   - `role` stays free-text for forward flexibility but the application
//     layer constrains v1 to 'admin' | 'member' (admin = full backstage
//     access, member = authenticated public-account holder).

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    displayName: text("display_name"),
    // Free-form text (not enum) for forward flexibility — promote to a
    // pgEnum once we know which other roles we need (author, reviewer,
    // viewer, etc.). v1 values: 'admin' | 'member'.
    //
    // Defaults to 'member', NOT 'admin' (migration 0038). Since 2026-07-31 this
    // column is a source-disclosure boundary, not only a UI permission:
    // audienceFor() in lib/chat/prompt-config-shared.ts reads it to decide
    // whether Metis may name the practice library. An insert path that forgets
    // this field must produce someone who CANNOT read the library out, so the
    // default has to fail closed. All four live insert paths set it explicitly
    // anyway; the default is the backstop for the fifth one.
    role: text("role").notNull().default("member"),
    // Argon2id hash (`$argon2id$v=19$m=19456,t=2,p=1$...`). NULL for
    // OAuth-only users + the legacy admin row before Phase 1 backfill.
    passwordHash: text("password_hash"),
    // Set at first email-link click OR first OAuth callback. NULL = pending.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // Soft-disable. is_active=false rejects sign-in attempts but keeps
    // the row + its FK pointers intact.
    isActive: boolean("is_active").notNull().default(true),
    // Bumped on password reset, admin force-logout, or role change.
    // Embedded in every issued JWT; mismatch rejects the JWT at the
    // Edge gate without a DB lookup. See plan §4.4 + E1.
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Missing in the original 0015 migration — added in Phase 1 for the
    // audit-trail consistency rule (CLAUDE.md DB §3). Defaults to created_at
    // for existing rows when the ALTER TABLE runs.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    // Serves admin "list admins" and "list members" UI. Partial on
    // is_active=true so soft-disabled accounts don't pollute the index.
    index("users_role_active_idx")
      .on(table.role)
      .where(sql`${table.isActive} = true`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ============================================================================
// oauth_account — Phase 1 of auth-roles port
// ============================================================================
// One row per (user, OAuth provider) link. v1 only writes provider='google'
// but the shape is provider-agnostic so Microsoft / GitHub land later
// without a migration. UNIQUE(provider, provider_subject) is the lookup
// key during the OAuth callback dance — a provider's 'sub' claim is the
// stable identity even across email changes on that provider.
//
// We deliberately do NOT store the OAuth access_token or refresh_token —
// sign-in is the only use case, no API calls back to Google needed.
// The booking system's Google Calendar OAuth (lib/booking-crypto.ts +
// consultant.google_refresh_token_encrypted) is a separate flow.

export const oauthAccount = pgTable(
  "oauth_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'google' for v1. Future: 'microsoft', 'github'.
    provider: text("provider").notNull(),
    // The provider's stable subject identifier (Google's `sub` claim).
    // Persists across email changes on the provider side.
    providerSubject: text("provider_subject").notNull(),
    // Email reported by the provider at link time. For audit / "users see
    // which Google email is linked" UI; NOT authoritative for sign-in.
    emailAtLink: text("email_at_link").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Login lookup: "is there a user linked to this Google sub?"
    unique("oauth_account_provider_subject_uniq").on(
      table.provider,
      table.providerSubject,
    ),
    // FK index (CLAUDE.md DB §4): "list a user's linked OAuth accounts"
    // for the /account page unlink UI.
    index("oauth_account_user_id_idx").on(table.userId),
  ],
);

export type OauthAccount = typeof oauthAccount.$inferSelect;
export type NewOauthAccount = typeof oauthAccount.$inferInsert;

// ============================================================================
// user_session — Phase 1 of auth-roles port (hybrid JWT + DB model, plan E1)
// ============================================================================
// Used alongside short-lived JWTs (not instead of). The cookie carries a
// 5-minute JWT with { userId, sessionId, tokenVersion }. proxy.ts (Edge)
// verifies signature only. Node route handlers re-fetch this row to check
// revoked_at + users.is_active. Sliding refresh on activity stamps
// last_seen_at and mints a fresh JWT from the same row.
//
// One row per device session. Revoking a session does NOT delete the row
// (audit-trail); revoked_at stamp is the kill switch. Expired sessions
// are swept by a future cleanup job; until then they sit harmlessly.
//
// Why no token_hash column? The JWT IS the bearer token; the session row
// is just the revocable handle that the JWT references by id. No additional
// secret to store.

export const userSession = pgTable(
  "user_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Hard expiry. Independent of the 5-minute JWT TTL — the session row
    // expires after ~7 days of inactivity; sliding refresh extends it.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Stamped when a route handler revokes the session (sign-out,
    // password reset, role change, etc.).
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Updated on every JWT refresh. Powers the /account "active sessions"
    // listing's "last seen" column.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK lookup: "list a user's active sessions" (account UI + revoke-all flow).
    index("user_session_user_id_idx").on(table.userId),
    // Sweep query: "find expired rows to purge."
    index("user_session_expires_at_idx").on(table.expiresAt),
    // /account "most recently used first" ordering.
    index("user_session_user_id_last_seen_at_idx").on(
      table.userId,
      table.lastSeenAt,
    ),
  ],
);

export type UserSession = typeof userSession.$inferSelect;
export type NewUserSession = typeof userSession.$inferInsert;

// ============================================================================
// auth_event — Phase 1 of auth-roles port (audit log, plan D4)
// ============================================================================
// Append-only forensic trail of every auth-relevant action. No update path;
// no updated_at (mirrors integration_secret_audit). Writes never block the
// auth flow — failure logs to stderr and continues (see plan §9 Audit log).
//
// user_id is nullable because failed-login rows reference an email that
// may not match any user (and we deliberately don't leak that fact via
// the response timing — see §9 Email enumeration defense).
//
// event_type values (v1, application-layer constrained):
//   'register' | 'login_password' | 'login_oauth' | 'login_magic' |
//   'login_failed' | 'login_session_upgraded' | 'logout' |
//   'password_reset_requested' | 'password_changed' |
//   'email_change_requested' | 'email_changed' | 'role_changed' |
//   'oauth_linked' | 'oauth_unlinked' | 'user_deactivated' |
//   'user_reactivated' | 'session_revoked'

export const authEvent = pgTable(
  "auth_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: failed-login rows for unknown emails have no user FK.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Event-specific payload. Documented shapes per event_type:
    //   login_oauth: { provider: 'google' }
    //   role_changed: { from_role, to_role, changed_by_user_id }
    //   login_failed: { reason: 'wrong_password' | 'unknown_email' }
    //   login_session_upgraded: { from: 'lead_jwt' }
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK lookup: "show this user's auth history" (admin user-detail page).
    index("auth_event_user_id_idx").on(table.userId),
    // Reverse-chrono admin view: "recent auth activity across all users."
    index("auth_event_created_at_idx").on(table.createdAt),
    // "Show all role changes" / "show all failed logins" admin filters.
    index("auth_event_event_type_idx").on(table.eventType),
  ],
);

export type AuthEvent = typeof authEvent.$inferSelect;
export type NewAuthEvent = typeof authEvent.$inferInsert;

// ============================================================================
// auth_setting — Phase 1 of auth-roles port (admin-controlled auth config)
// ============================================================================
// Admin-controllable config for the Authentication settings page. Mirrors
// site_setting's key-value JSONB shape so the admin UI pattern is identical.
// Secrets (Google client secret, Turnstile secret) are encrypted at rest
// via the existing lib/integrations-crypto.ts helper before being stored
// in the `value` JSONB.
//
// Expected v1 keys:
//   'google_oauth_enabled': { enabled: boolean }
//   'google_client_id': { value: string }
//   'google_client_secret_encrypted': { ciphertext: string, iv: string }
//   'turnstile_enabled': { enabled: boolean }
//   'turnstile_site_key': { value: string }
//   'turnstile_secret_key_encrypted': { ciphertext: string, iv: string }
//   'public_signup_enabled': { enabled: boolean }

export const authSetting = pgTable("auth_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Logical setting name. Upserts target this column.
  key: text("key").notNull().unique(),
  // Setting payload — shape varies per key. Application layer validates (Zod).
  value: jsonb("value").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuthSetting = typeof authSetting.$inferSelect;
export type NewAuthSetting = typeof authSetting.$inferInsert;

// ============================================================================
// Relations — auth tables
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  oauthAccounts: many(oauthAccount),
  sessions: many(userSession),
  authEvents: many(authEvent),
  cdmpExamSessions: many(cdmpExamSession),
  assessmentSessions: many(assessmentSession),
  magicLinkTokens: many(magicLinkToken),
  skills: many(skill),
  workflows: many(workflow),
  workflowExecutionRuns: many(workflowExecutionRun),
  rules: many(userRule),
  conversations: many(conversation),
  conversationShares: many(conversationShare),
  socialAccounts: many(socialAccount),
}));

export const oauthAccountRelations = relations(oauthAccount, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccount.userId],
    references: [users.id],
  }),
}));

export const userSessionRelations = relations(userSession, ({ one }) => ({
  user: one(users, {
    fields: [userSession.userId],
    references: [users.id],
  }),
}));

export const authEventRelations = relations(authEvent, ({ one }) => ({
  user: one(users, {
    fields: [authEvent.userId],
    references: [users.id],
  }),
}));

// ── In-app per-user chat memory (pgvector) ─────────────────────────
// Replaces the external GBrain service. OLTP, 2NF: every non-key column
// depends only on `id`. `embedding` is the documented pgvector exception.
// Recall is an exact cosine scan over one user's slice — deliberately NO
// ANN index (a tenant-filtered HNSW under-recalls; per-user slices are
// small). The only index is the FK btree on user_id.
export const userMemory = pgTable(
  "user_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull().default("chat"),
    title: text("title"),
    body: text("body").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    // Distillation consolidation (migration 0033). A fact is superseded, not
    // deleted, when a newer fact contradicts it — soft-delete so a wrong
    // supersede is recoverable. Recall/list/status filter on is_active.
    isActive: boolean("is_active").notNull().default(true),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // Provenance pointer (no FK — soft reference, never queried by).
    sourceConversationId: uuid("source_conversation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Recall pre-filter + Brain-page listing: WHERE user_id = $1.
    index("user_memory_user_id_idx").on(table.userId),
    // Recall/list scan only live facts: WHERE user_id = $1 AND is_active.
    index("user_memory_user_active_idx")
      .on(table.userId)
      .where(sql`is_active`),
    // The partial UNIQUE (user_id, md5(body)) WHERE is_active — the
    // double-insert guard — is an expression index, declared in the
    // migration SQL (Drizzle has no expression-index builder). See
    // drizzle/0033_user_memory_consolidation.sql.
  ],
);

export const userMemoryRelations = relations(userMemory, ({ one }) => ({
  user: one(users, {
    fields: [userMemory.userId],
    references: [users.id],
  }),
}));

export type UserMemory = typeof userMemory.$inferSelect;
export type NewUserMemory = typeof userMemory.$inferInsert;

// Workspace memory (Phase 1 of workspace-memory). The ORG-scoped shared tier —
// the counterpart to per-user user_memory. Workspace entities (projects,
// clients, social posts, skills, kanban cards) are distilled into atomic facts
// and embedded here so chat recall grounds in the whole org's book of work.
// OLTP, 2NF; `embedding` is the documented pgvector exception.
//
// Unlike user_memory (tiny per-user slices → exact cosine scan, NO ANN index),
// this shared tier spans many entities across a team, so it gets an HNSW ANN
// index (declared in migration SQL — matches post.embedding). Recall filters by
// organisation_id (the isolation boundary) + is_active.
export const workspaceMemory = pgTable(
  "workspace_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    // Which kind of entity this fact came from: 'project' | 'client' |
    // 'social_post' | 'skill' | 'kanban_card' | ...
    sourceType: text("source_type").notNull(),
    // The source entity's id — soft reference (polymorphic across entity types,
    // so no single FK). Used to supersede/deactivate an entity's facts on
    // update/delete and to render E1 provenance.
    sourceEntityId: uuid("source_entity_id"),
    title: text("title"),
    body: text("body").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    // Supersede-on-conflict, same as user_memory: a fact is soft-deleted, not
    // removed, when a newer fact replaces it or its source entity is deleted.
    isActive: boolean("is_active").notNull().default(true),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK-backed recall pre-filter: WHERE organisation_id = $1.
    index("workspace_memory_org_id_idx").on(table.organisationId),
    // Recall/list over LIVE facts only: WHERE organisation_id = $1 AND is_active.
    index("workspace_memory_org_active_idx")
      .on(table.organisationId)
      .where(sql`is_active`),
    // Ingest hook lookup: find an entity's facts to supersede/deactivate on
    // source update/delete — WHERE source_type = $1 AND source_entity_id = $2.
    index("workspace_memory_source_idx").on(
      table.sourceType,
      table.sourceEntityId,
    ),
    // HNSW ANN index + the partial UNIQUE (organisation_id, md5(body)) WHERE
    // is_active dedup guard are expression/opclass indexes declared in the
    // migration SQL — see drizzle/0035_workspace_memory.sql.
  ],
);

export const workspaceMemoryRelations = relations(workspaceMemory, ({ one }) => ({
  organisation: one(organisation, {
    fields: [workspaceMemory.organisationId],
    references: [organisation.id],
  }),
}));

export type WorkspaceMemory = typeof workspaceMemory.$inferSelect;
export type NewWorkspaceMemory = typeof workspaceMemory.$inferInsert;

export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    // Short summary used in /blog index card + JSON-LD og:description +
    // newsletter card preview. Generated by Claude at migration time;
    // editable in admin.
    excerpt: text("excerpt"),
    // Markdown source of truth. Capped at 200KB at the API layer (Zod).
    // Migration runs WP HTML → Turndown markdown before insert.
    contentMd: text("content_md").notNull().default(""),
    // Per-post SEO overrides. NULL = fall back to title / excerpt.
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // Path to the @vercel/og-generated branded image (E3 of the CEO plan).
    // Format: "/og/{slug}.png" or R2 URL. NULL means no image generated yet.
    ogImagePath: text("og_image_path"),
    // When the OG image was last regenerated. Migration sets it; admin
    // re-generates on title or excerpt change.
    ogImageGeneratedAt: timestamp("og_image_generated_at", {
      withTimezone: true,
    }),
    // ---- Phase D image metadata (migration 0016) ----
    // Alt text for a11y + SEO. Enforced as required at the upload route
    // layer (not as a DB CHECK constraint) so the 253 migrated rows
    // could be grandfathered + backfilled separately. Render layer
    // falls back to post.title when NULL.
    ogImageAlt: text("og_image_alt"),
    // Intrinsic pixel dimensions — read from file at upload time. Used
    // by next/image to avoid CLS (cumulative layout shift). NULL on
    // migrated rows until backfilled.
    ogImageWidth: integer("og_image_width"),
    ogImageHeight: integer("og_image_height"),
    // Original filename built from slug: `{slug}-featured-01.{ext}`.
    // Lowercased, no spaces.
    ogImageFilename: text("og_image_filename"),
    // Mime type — CHECK-constrained to 'image/png' | 'image/jpeg' |
    // 'image/webp'. Validated at upload before R2 write.
    ogImageMimeType: text("og_image_mime_type"),
    // File size in kilobytes (integer). CHECK-constrained <= 500.
    // Application layer warns at 150 KB.
    ogImageSizeKb: integer("og_image_size_kb"),
    // FK to users.id (the seeded 'admin' row, until per-user login).
    // ON DELETE SET NULL so deleting a user doesn't blank the metadata.
    ogImageUploadedBy: uuid("og_image_uploaded_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    // Upload timestamp. Separate from og_image_generated_at (which
    // tracks satori-renderer output, a different concern).
    ogImageUploadedAt: timestamp("og_image_uploaded_at", {
      withTimezone: true,
    }),
    // Sha256 of the file bytes — for dedupe + integrity. Partial index
    // exists for lookup.
    ogImageChecksum: text("og_image_checksum"),
    // Full R2 key (path inside the bucket, no leading slash). Kept
    // separate from the public URL so the future cleanup job can
    // identify + reap orphaned R2 objects.
    ogImageR2Key: text("og_image_r2_key"),
    // Soft-delete stamp. When admin removes an image, this is set but
    // og_image_path stays populated for a grace period before the
    // cleanup job nullifies it + deletes the R2 object.
    ogImageDeletedAt: timestamp("og_image_deleted_at", {
      withTimezone: true,
    }),
    // Editorial author. Nullable for safety during migration (set NOT NULL
    // in a follow-up after backfill); rendering treats NULL as "Archos Labs"
    // generic byline.
    authorId: uuid("author_id").references(() => author.id, {
      onDelete: "set null",
    }),
    // Editorial category. Required for migrated posts (Yoast source always
    // has one). Nullable here for safety during migration backfill; the
    // admin save flow refuses NULL.
    categoryId: uuid("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    // Free-form tags array. String values, application-validated against
    // a stable taxonomy at write time. JSONB chosen over a `post_tag`
    // junction because the analytic need is trivial at 200-post scale.
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // 'draft' | 'scheduled' | 'published' | 'archived'. Migration sets
    // 'published' for everything successfully transformed; admin save
    // governs transitions.
    status: text("status").notNull().default("draft"),
    // 'listed' | 'unlisted'. See lifecycle comment above. Default 'listed'
    // so manually-authored new posts surface in /blog; migration script
    // sets per-post based on editorial review.
    visibility: text("visibility").notNull().default("listed"),
    // Voyage voyage-3-large embedding. NULL until embed step of the
    // migration runs (or until next admin save for hand-authored posts).
    // Read-next + /search degrade gracefully when this is NULL.
    embedding: vector("embedding", { dimensions: 1024 }),
    // Computed from contentMd at save time; powers the reading-time pill
    // displayed in the post header.
    wordCount: integer("word_count").notNull().default(0),
    readingTimeMin: integer("reading_time_min").notNull().default(0),
    // Claude polish (E2) flag. TRUE means the post needs human review
    // before going public — surfaces in the admin "Needs review" queue.
    // Migration script sets this when Claude returns a low-confidence
    // currency check OR malformed output.
    needsReview: boolean("needs_review").notNull().default(false),
    // TRUE for posts written by the blog writer agent. Two jobs:
    //   1. Scopes the publish gate. scheduled-publisher withholds a due post
    //      only when this AND needs_review are both true, so a human editor
    //      flagging their own scheduled post still publishes exactly as
    //      before. needs_review is a GENERAL editorial flag (the WP migration
    //      set it on 120 posts); gating on it alone would have silently
    //      changed behaviour for human-authored posts.
    //   2. Marks agent output in the admin list so it is distinguishable from
    //      the legacy WP needs-review queue.
    // No index: only ever read alongside status='scheduled', which the
    // partial index post_due_for_publish_idx already serves.
    isAgentGenerated: boolean("is_agent_generated").notNull().default(false),
    // When a human explicitly confirmed they read this post. NULL = nobody
    // has. Drives the "Reviewed by Rob Angeles" byline and the editor +
    // contributor fields in the Article JSON-LD, so it must only ever be set
    // by a deliberate human action — never inferred, never backfilled.
    //
    // Three existing columns look like they could carry this and none can:
    //   needs_review       general editorial flag, and false on every
    //                      PUBLISHED agent post by construction
    //                      (lib/blog-agent/run.ts:557)
    //   last_reviewed_at   already drives dateModified / modified_time /
    //                      sitemap lastmod / llms.txt freshness
    //   is_agent_generated says who WROTE it, not who checked it
    //
    // No index on purpose: only ever read on a row already fetched by slug or
    // id, never filtered/joined/sorted on. See drizzle/0037.
    reviewedByHumanAt: timestamp("reviewed_by_human_at", {
      withTimezone: true,
    }),
    // WordPress uhiz_posts.ID — the migration idempotency key. NULL for
    // posts authored directly in admin (no WP origin).
    sourceWpId: integer("source_wp_id"),
    // "Last reviewed" stamp — separate from updated_at. Migration sets to
    // the original WP publish date; admin updates when content is refreshed.
    // Shown in the post-header micro-row ("Last reviewed: 2026-03").
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    // First-publish timestamp. NULL until first publish; preserved across
    // re-publishes (mirrors `page.published_at` semantics).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // When `status='scheduled'`, the UTC instant at which the publisher
    // cron should flip status to 'published'. NULL for every other status.
    // Validated at the admin save boundary (Zod + service): must be in the
    // future, cleared when status flips off 'scheduled'.
    scheduledPublishAt: timestamp("scheduled_publish_at", {
      withTimezone: true,
    }),
    // Soft-delete. archived_at NOT NULL hides the post from public listings
    // but preserves it (and its revisions) for restore.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // /blog index hot path:
    //   SELECT ... WHERE status='published' AND visibility='listed'
    //               AND archived_at IS NULL
    //   ORDER BY published_at DESC LIMIT ... OFFSET ...
    index("post_status_visibility_published_at_idx").on(
      table.status,
      table.visibility,
      table.publishedAt,
    ),
    // FK lookup: list a category's posts (/blog/category/[slug]).
    index("post_category_id_idx").on(table.categoryId),
    // FK lookup: list an author's posts (Phase 4 author archive).
    index("post_author_id_idx").on(table.authorId),
    // Admin archive view: WHERE archived_at IS NOT NULL.
    index("post_archived_at_idx").on(table.archivedAt),
    // Migration idempotency: upsert key during scripts/migrate-wp/. NULLs
    // remain distinct in Postgres, so manually-authored posts coexist with
    // migrated posts without collision.
    index("post_source_wp_id_idx").on(table.sourceWpId),
    // Admin "needs review" queue — partial index keeps it small (only ~5%
    // of rows expected to be flagged at any time).
    index("post_needs_review_idx")
      .on(table.needsReview)
      .where(sql`needs_review = true`),
    // Publisher cron hot path:
    //   SELECT id FROM post
    //     WHERE status='scheduled' AND scheduled_publish_at <= now()
    //     ORDER BY scheduled_publish_at FOR UPDATE SKIP LOCKED LIMIT 20
    // Partial index keeps it tiny — rows with status != 'scheduled' don't
    // appear in this index at all.
    index("post_due_for_publish_idx")
      .on(table.scheduledPublishAt)
      .where(sql`status = 'scheduled'`),
    // Phase D image metadata indexes (migration 0016).
    // FK lookup (mandatory per CLAUDE.md): "list a user's uploads".
    index("post_og_image_uploaded_by_idx").on(table.ogImageUploadedBy),
    // Dedupe lookups on re-upload. Partial — only rows with a checksum
    // participate so the index stays tiny at 253-post scale.
    index("post_og_image_checksum_idx")
      .on(table.ogImageChecksum)
      .where(sql`og_image_checksum IS NOT NULL`),
    // Future R2 cleanup job query — "find images soft-deleted past
    // grace period". Partial — only soft-deleted rows participate.
    index("post_og_image_deleted_at_idx")
      .on(table.ogImageDeletedAt)
      .where(sql`og_image_deleted_at IS NOT NULL`),
    // pgvector HNSW index for read-next + /search ANN queries:
    //   SELECT ... ORDER BY embedding <=> $1 LIMIT 3
    // Created in custom SQL (drizzle has no HNSW builder yet) — see the
    // migration file. Parameters: m=16, ef_construction=64.
  ],
);

export type Post = typeof post.$inferSelect;
export type NewPost = typeof post.$inferInsert;

// ============================================================================
// post_revision — Translation Layer (rosy-bee)
// ============================================================================
// Immutable audit trail. One row per admin save, including the initial
// create. Mirrors `page_revision` exactly — same diff_size_pct heuristic,
// same cascade-delete posture, same `saved_by` text column.
//
// CASCADE delete on post_id: revisions vanish only when the post row
// itself is hard-deleted (which only happens via direct DB tooling,
// never via admin — admin uses soft-delete via archived_at).

export const postRevision = pgTable(
  "post_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    excerpt: text("excerpt"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // 0-100. Percentage change in content_md vs the prior revision. First
    // revision (create) is always 100.00. Mirrors page_revision shape.
    diffSizePct: numeric("diff_size_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    // Admin identity that performed the save. Single-admin model today;
    // matches pageRevision shape so multi-admin can land later as a FK
    // without rewriting this column.
    savedBy: text("saved_by").notNull().default("admin"),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary query: "show revisions for this post, newest first."
    // Admin revision-history view + restore flow.
    index("post_revision_post_id_saved_at_idx").on(
      table.postId,
      table.savedAt,
    ),
  ],
);

export type PostRevision = typeof postRevision.$inferSelect;
export type NewPostRevision = typeof postRevision.$inferInsert;

// ============================================================================
// newsletter_signup — Translation Layer (rosy-bee)
// ============================================================================
// Newsletter capture for "The Translation Layer" — email list owned by
// Archos Labs (vendor: Resend Audiences per CEO plan E6.1). One row per
// email address, double-opt-in confirmation gate before send.
//
// Lifecycle:
//
//   (signup form) ──INSERT──▶ pending ─(click confirm link)─▶ confirmed
//                                │                              │
//                                │ token >72h old               │
//                                ▼                              ▼
//                            expired ──re-send──▶ pending     active
//                                                              (Resend sync)
//
// `source_post_id` tracks which post drove the signup (for attribution
// analytics) — NULL for footer signups or homepage form. CASCADE delete on
// source post: signup row survives the post being hard-deleted (the email
// belongs to the list, not the post) — use SET NULL.
//
// `confirmed_at` NULL means pending; NOT NULL means confirmed and synced
// to Resend Audiences. Idempotent on email: a second signup of an already-
// confirmed email returns 200 with "already subscribed" friendly message.

export const newsletterSignup = pgTable(
  "newsletter_signup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // Post that drove the signup; SET NULL on post deletion (the email
    // belongs to the list, not the post).
    sourcePostId: uuid("source_post_id").references(
      (): AnyPgColumn => post.id,
      { onDelete: "set null" },
    ),
    // NULL until the user clicks the double-opt-in confirmation link.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Random 32-byte token, hex-encoded. Used in the confirmation link
    // sent via Resend. NULL after confirm.
    doubleOptInToken: text("double_opt_in_token"),
    // When the token was issued; used to enforce a 72-hour expiry on the
    // confirm link.
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }),
    // Optional UTM-style fields for source attribution beyond source_post.
    utmSource: text("utm_source"),
    utmCampaign: text("utm_campaign"),
    // Privacy: IP/UA stored hashed (sha256, no salt) so we can rate-limit
    // and detect abuse without keeping raw identifiers. Existing retention
    // job purges these at 30 days (see scripts/purge-old-ip-ua.mjs).
    ipHash: text("ip_hash"),
    uaHash: text("ua_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK lookup: list signups attributed to a given post.
    index("newsletter_signup_source_post_id_idx").on(table.sourcePostId),
    // Confirm endpoint: WHERE double_opt_in_token = $1.
    index("newsletter_signup_token_idx").on(table.doubleOptInToken),
    // Admin filter: WHERE confirmed_at IS NULL — pending list.
    index("newsletter_signup_confirmed_at_idx").on(table.confirmedAt),
  ],
);

export type NewsletterSignup = typeof newsletterSignup.$inferSelect;
export type NewNewsletterSignup = typeof newsletterSignup.$inferInsert;

// ============================================================================
// Relations — Translation Layer
// ============================================================================

export const authorRelations = relations(author, ({ many }) => ({
  posts: many(post),
}));

export const categoryRelations = relations(category, ({ many }) => ({
  posts: many(post),
}));

export const postRelations = relations(post, ({ one, many }) => ({
  author: one(author, {
    fields: [post.authorId],
    references: [author.id],
  }),
  category: one(category, {
    fields: [post.categoryId],
    references: [category.id],
  }),
  revisions: many(postRevision),
  newsletterSignups: many(newsletterSignup),
}));

export const postRevisionRelations = relations(postRevision, ({ one }) => ({
  post: one(post, {
    fields: [postRevision.postId],
    references: [post.id],
  }),
}));

export const newsletterSignupRelations = relations(
  newsletterSignup,
  ({ one }) => ({
    sourcePost: one(post, {
      fields: [newsletterSignup.sourcePostId],
      references: [post.id],
    }),
  }),
);

// ============================================================================
// knowledge_document — CDMP Practice Exam (knowledge base)
// ============================================================================
// Metadata for an ingested reference document (DMBOK PDF, supplementary
// texts). One row per source document. Chunks are stored separately in
// knowledge_chunk with a CASCADE FK back here. content_hash enables
// deduplication — re-uploading the same file is a no-op.
//
// status lifecycle: processing → ready | failed
//   processing: ingestion in progress (chunking + embedding)
//   ready: all chunks embedded successfully
//   failed: ingestion pipeline errored (last_error has details)

export const knowledgeDocument = pgTable("knowledge_document", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  // 'pdf' | 'text' | 'url'. Determines which parser the ingest pipeline uses.
  sourceType: text("source_type").notNull(),
  // TOPIC domain. Since migration 0039 the values are the five canonical
  // domains: 'dmbok' | 'consulting' | 'engineering' | 'analytics' | 'startup'.
  // Still text rather than an enum so a new shelf can be added without a
  // migration; the retag script is the source of truth for the vocabulary.
  //
  // This is NOT a permission. It says what a document is about, nothing more.
  // See is_cdmp_source below for why that distinction is load-bearing.
  category: text("category"),
  // Author(s) as they should be cited, e.g. 'Peter Block'. User-facing: an
  // internal-session Metis turn names the work it draws on, so this renders
  // into chat output. Nullable — a document may legitimately have no author.
  author: text("author"),
  publicationYear: integer("publication_year"),
  // Whether CDMP certification practice-exam questions may be drawn from this
  // document. DELIBERATELY SEPARATE from category (migration 0039).
  //
  // lib/cdmp/generate.ts used to select exam material with
  // `searchKnowledge(label, "dmbok", n)` — treating a topic label as an
  // approval flag. In PROD that meant 6 documents fed the certification pool
  // that had no business there, The Trusted Advisor among them. The two
  // questions are genuinely different: The Unified Star Schema is
  // data-management by topic but out-of-syllabus for DAMA, and the old scheme
  // had no way to say so.
  //
  // Defaults false: a newly ingested document is not exam material until
  // someone approves it.
  isCdmpSource: boolean("is_cdmp_source").notNull().default(false),
  // sha256 of the raw file bytes. UNIQUE so re-uploading the same file
  // is rejected at the DB layer rather than silently duplicated.
  contentHash: text("content_hash").notNull().unique(),
  // 'processing' | 'ready' | 'failed'. See lifecycle comment above.
  status: text("status").notNull().default("processing"),
  // Number of chunks produced from this document. Populated after
  // chunking completes; used in the admin list view.
  chunkCount: integer("chunk_count").notNull().default(0),
  // Human-readable error message when status='failed'.
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type KnowledgeDocument = typeof knowledgeDocument.$inferSelect;
export type NewKnowledgeDocument = typeof knowledgeDocument.$inferInsert;

// ============================================================================
// knowledge_chunk — CDMP Practice Exam (knowledge base)
// ============================================================================
// One row per text chunk extracted from a knowledge_document. Each chunk
// carries a 1024-dim embedding (matching the existing post.embedding
// infrastructure — same model, same dimensions, same cosine distance).
//
// Chunking strategy (ported from cc-culinaire-kitchen):
//   ~1000 tokens per chunk, 200-token overlap, paragraph-boundary splits.
//
// CASCADE delete on document_id: removing a document purges all its chunks
// and their embeddings in one operation.

export const knowledgeChunk = pgTable(
  "knowledge_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocument.id, { onDelete: "cascade" }),
    // The actual text content of this chunk.
    content: text("content").notNull(),
    // 1024-dim embedding from text-embedding-3-large via OpenRouter.
    // Matches post.embedding dimensions for infrastructure reuse.
    embedding: vector("embedding", { dimensions: 1024 }),
    // 0-based position within the source document. Preserves reading
    // order for context reconstruction when multiple chunks are retrieved.
    chunkIndex: integer("chunk_index").notNull(),
    // Source location metadata: chapter title, page range, section heading.
    // Shape varies per source_type; application layer validates (Zod).
    metadata: jsonb("metadata").notNull().default({}),
    // DMBOK chapter this chunk belongs to, e.g. "Chapter 13". NULL = front/back
    // matter or unassignable — excluded from CDMP specialist exam pools (the
    // Fundamentals exam ignores this column; it uses semantic search). Populated
    // in place by the chapter-detection backfill; only set for the DMBOK document.
    chapter: text("chapter"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK lookup: "list all chunks for this document" (admin detail view,
    // cascade delete verification).
    index("knowledge_chunk_document_id_idx").on(table.documentId),
    // Ordered retrieval: "chunks for document X in reading order."
    index("knowledge_chunk_document_id_chunk_index_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
    // CDMP specialist generation: "fetch all chunks for one chapter."
    index("knowledge_chunk_chapter_idx").on(table.chapter),
  ],
);

export type KnowledgeChunk = typeof knowledgeChunk.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunk.$inferInsert;

// ============================================================================
// cdmp_exam_session — CDMP Practice Exam
// ============================================================================
// One row per practice exam attempt. user_id FK to the users table —
// registration is required before taking the exam. Config captures the
// session parameters (question count, timer, target score threshold).
//
// status lifecycle: in_progress → completed | abandoned
//   in_progress: user is actively answering questions
//   completed: all questions answered (or timer expired), score computed
//   abandoned: user left mid-exam without completing

export const cdmpExamSession = pgTable(
  "cdmp_exam_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // { questionCount: 20|40|60|100, timerEnabled: boolean,
    //   timerSeconds: number, targetThreshold: 60|70|80 }
    config: jsonb("config").notNull(),
    // 'in_progress' | 'completed' | 'abandoned'. See lifecycle above.
    status: text("status").notNull().default("in_progress"),
    // Total questions served in this session.
    questionCount: integer("question_count").notNull(),
    // 'fundamentals' (all 14 areas, weighted) | 'specialist' (one DMBOK chapter).
    examType: text("exam_type").notNull().default("fundamentals"),
    // Specialist exams: the knowledge-area slug (e.g. 'data_quality'); one of
    // SPECIALIST_AREA_SLUGS. NULL for fundamentals.
    specialistArea: text("specialist_area"),
    // Final score: number of correct answers.
    correctCount: integer("correct_count"),
    // Final score as percentage (0-100). Computed at completion.
    scorePercent: integer("score_percent"),
    // Whether the user met their target threshold.
    passed: boolean("passed"),
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
  (table) => [
    // "List a user's exam history, newest first."
    index("cdmp_exam_session_user_id_idx").on(table.userId),
    // Admin analytics: "count completed vs abandoned sessions."
    index("cdmp_exam_session_status_idx").on(table.status),
    // Admin analytics: "completed specialist exams per subject."
    index("cdmp_exam_session_specialist_area_idx").on(table.specialistArea),
  ],
);

export type CdmpExamSession = typeof cdmpExamSession.$inferSelect;
export type NewCdmpExamSession = typeof cdmpExamSession.$inferInsert;

// ============================================================================
// cdmp_exam_answer — CDMP Practice Exam
// ============================================================================
// One row per answered question in a session. Stores the full question
// content (denormalized) because questions are generated on the fly —
// there is no stable question ID to reference. This ensures the review
// screen can always reconstruct exactly what the user saw.
//
// JSONB exception per CLAUDE.md §1: options is a structured array
// validated by the application layer (Zod). Denormalization justified:
// questions are ephemeral (generated per-session), not canonical entities.

export const cdmpExamAnswer = pgTable(
  "cdmp_exam_answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cdmpExamSession.id, { onDelete: "cascade" }),
    // 0-based position within the exam (matches display order).
    questionIndex: integer("question_index").notNull(),
    // The generated question text shown to the user.
    questionText: text("question_text").notNull(),
    // [{ code: 'A'|'B'|'C'|'D'|'E', label: string }]
    options: jsonb("options").notNull(),
    // 'A' | 'B' | 'C' | 'D' | 'E'. What the user selected.
    userAnswer: text("user_answer").notNull(),
    // 'A' | 'B' | 'C' | 'D' | 'E'. The verified correct answer.
    correctAnswer: text("correct_answer").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    // DMBOK knowledge area slug (e.g. 'data_governance').
    knowledgeArea: text("knowledge_area").notNull(),
    // Explanation text referencing the DMBOK chapter.
    explanation: text("explanation").notNull(),
    // DMBOK chapter reference (e.g. 'Chapter 3 — Data Governance').
    dmbokChapterRef: text("dmbok_chapter_ref").notNull(),
    // IDs of knowledge_chunk rows used to generate this question.
    // Enables flagging and quality analysis per source chunk.
    chunkIds: jsonb("chunk_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "List all answers for a session in order."
    index("cdmp_exam_answer_session_id_idx").on(table.sessionId),
    // Per-chapter analytics: "how do users perform on data_governance?"
    index("cdmp_exam_answer_knowledge_area_idx").on(table.knowledgeArea),
    // One answer per question per session. Enables upsert when user changes answer.
    unique("cdmp_exam_answer_session_question_uniq").on(
      table.sessionId,
      table.questionIndex,
    ),
  ],
);

export type CdmpExamAnswer = typeof cdmpExamAnswer.$inferSelect;
export type NewCdmpExamAnswer = typeof cdmpExamAnswer.$inferInsert;

// ============================================================================
// cdmp_question_flag — CDMP Practice Exam
// ============================================================================
// User-submitted flags for potentially incorrect generated questions.
// Links to the specific answer row so admins can see the full question
// context. Flags are reviewed via admin UI; status tracks resolution.
//
// No updated_at: flags are append-only from the user's perspective.
// Admin resolution updates status + resolved_at.

export const cdmpQuestionFlag = pgTable(
  "cdmp_question_flag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => cdmpExamAnswer.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Free-text reason the user thinks the question is wrong.
    reason: text("reason").notNull(),
    // 'pending' | 'reviewed' | 'dismissed'. Admin resolves via admin UI.
    status: text("status").notNull().default("pending"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK lookup: "list flags for this answer."
    index("cdmp_question_flag_answer_id_idx").on(table.answerId),
    // FK lookup: "list flags by this user."
    index("cdmp_question_flag_user_id_idx").on(table.userId),
    // Admin queue: "show all pending flags."
    index("cdmp_question_flag_status_idx").on(table.status),
  ],
);

export type CdmpQuestionFlag = typeof cdmpQuestionFlag.$inferSelect;
export type NewCdmpQuestionFlag = typeof cdmpQuestionFlag.$inferInsert;

// ============================================================================
// Relations — Knowledge Base + CDMP Practice Exam
// ============================================================================

export const knowledgeDocumentRelations = relations(
  knowledgeDocument,
  ({ many }) => ({
    chunks: many(knowledgeChunk),
  }),
);

export const knowledgeChunkRelations = relations(
  knowledgeChunk,
  ({ one }) => ({
    document: one(knowledgeDocument, {
      fields: [knowledgeChunk.documentId],
      references: [knowledgeDocument.id],
    }),
  }),
);

export const cdmpExamSessionRelations = relations(
  cdmpExamSession,
  ({ one, many }) => ({
    user: one(users, {
      fields: [cdmpExamSession.userId],
      references: [users.id],
    }),
    answers: many(cdmpExamAnswer),
  }),
);

export const cdmpExamAnswerRelations = relations(
  cdmpExamAnswer,
  ({ one, many }) => ({
    session: one(cdmpExamSession, {
      fields: [cdmpExamAnswer.sessionId],
      references: [cdmpExamSession.id],
    }),
    flags: many(cdmpQuestionFlag),
  }),
);

export const cdmpQuestionFlagRelations = relations(
  cdmpQuestionFlag,
  ({ one }) => ({
    answer: one(cdmpExamAnswer, {
      fields: [cdmpQuestionFlag.answerId],
      references: [cdmpExamAnswer.id],
    }),
    user: one(users, {
      fields: [cdmpQuestionFlag.userId],
      references: [users.id],
    }),
  }),
);

// ============================================================================
// skill — Skills Builder (workspace feature)
// ============================================================================
// A reusable AI prompt template with structured inputs, model config, and
// versioning. v1 is single-user (Rob's consulting toolkit). Community
// features (fork, favorites, public visibility) deferred to v2.
//
// Normal form: 2NF. prompt_template and system_prompt are scalar columns
// (not embedded in JSONB). Inputs and outputs are normalized into separate
// tables. The only JSONB exception is skill_versions.config which stores
// full version snapshots for rollback/audit.

export const skill = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    // repurpose | generate | research | transform | extract | plan
    category: varchar("category", { length: 50 }).notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promptTemplate: text("prompt_template").notNull().default(""),
    systemPrompt: text("system_prompt"),
    // OpenRouter model ID, e.g. 'anthropic/claude-sonnet-4-20250514'
    defaultModel: varchar("default_model", { length: 100 }),
    // 0.0-2.0, validated by Zod at the API layer.
    temperature: numeric("temperature", { precision: 3, scale: 2 }),
    // 1-32000, validated by Zod. Clamped to model max if exceeded.
    maxTokens: integer("max_tokens"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Lookup skills by owner.
    index("skill_user_id_idx").on(table.userId),
    // Slug scoped to user (namespace isolation).
    uniqueIndex("skill_user_slug_idx").on(table.userId, table.slug),
  ],
);

export type Skill = typeof skill.$inferSelect;
export type NewSkill = typeof skill.$inferInsert;

// ============================================================================
// skill_input — Skills Builder (normalized input definitions)
// ============================================================================
// Normal form: 2NF. Each row defines one input variable for a skill's
// prompt template. The key maps to a {{variable}} placeholder in
// prompt_template.

export const skillInput = pgTable(
  "skill_input",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    // Template variable name, e.g. 'content', 'topic'.
    key: varchar("key", { length: 100 }).notNull(),
    // text | multiline | select
    type: varchar("type", { length: 30 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    description: text("description"),
    isRequired: boolean("is_required").notNull().default(false),
    defaultValue: varchar("default_value", { length: 500 }),
    // string[] — only used when type='select'. Application validates shape.
    options: jsonb("options").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List inputs for a skill in order.
    index("skill_input_skill_id_idx").on(table.skillId),
  ],
);

export type SkillInput = typeof skillInput.$inferSelect;
export type NewSkillInput = typeof skillInput.$inferInsert;

// ============================================================================
// skill_output — Skills Builder (normalized output definitions)
// ============================================================================
// Normal form: 2NF. Defines expected output structure so the frontend
// knows how to render LLM responses (markdown preview vs raw JSON vs
// plain text).

export const skillOutput = pgTable(
  "skill_output",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    // text | markdown | json
    type: varchar("type", { length: 30 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List outputs for a skill in order.
    index("skill_output_skill_id_idx").on(table.skillId),
  ],
);

export type SkillOutput = typeof skillOutput.$inferSelect;
export type NewSkillOutput = typeof skillOutput.$inferInsert;

// ============================================================================
// skill_version — Skills Builder (config snapshots for rollback/audit)
// ============================================================================
// Normal form: 1NF — config JSONB stores a full value-copy snapshot
// of the skill's inputs, outputs, prompt, and model config at a point
// in time. Shape: { inputs: SkillInputDef[], outputs: SkillOutputDef[],
//   promptTemplate: string, systemPrompt?: string, temperature: number,
//   maxTokens: number, defaultModel: string }
//
// A new version row is created whenever prompt_template, system_prompt,
// inputs, or outputs change. Metadata-only edits (name, description,
// category) do NOT create a version.

export const skillVersion = pgTable(
  "skill_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    changelog: text("changelog"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List versions for a skill.
    index("skill_version_skill_id_idx").on(table.skillId),
  ],
);

export type SkillVersion = typeof skillVersion.$inferSelect;
export type NewSkillVersion = typeof skillVersion.$inferInsert;

// ============================================================================
// Relations — Skills Builder
// ============================================================================

export const skillRelations = relations(skill, ({ one, many }) => ({
  user: one(users, {
    fields: [skill.userId],
    references: [users.id],
  }),
  inputs: many(skillInput),
  outputs: many(skillOutput),
  versions: many(skillVersion),
  workflowSteps: many(workflowStep),
}));

export const skillInputRelations = relations(skillInput, ({ one }) => ({
  skill: one(skill, {
    fields: [skillInput.skillId],
    references: [skill.id],
  }),
}));

export const skillOutputRelations = relations(skillOutput, ({ one }) => ({
  skill: one(skill, {
    fields: [skillOutput.skillId],
    references: [skill.id],
  }),
}));

export const skillVersionRelations = relations(skillVersion, ({ one }) => ({
  skill: one(skill, {
    fields: [skillVersion.skillId],
    references: [skill.id],
  }),
}));

// ============================================================================
// workflow — Workflows (AI orchestration pipelines)
// ============================================================================
// Normal form: 2NF. Fields and steps are normalized into child tables.
// A workflow chains multiple skills into a sequential pipeline: "one idea
// in, twelve assets out." v1 is single-user (Rob's consulting toolkit).

export const workflow = pgTable(
  "workflow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" } as never),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // draft | published | archived
    status: text("status").notNull().default("draft"),
    // JSONB exception: freeform style config, validated by Zod
    style: jsonb("style"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Lookup workflows by owner.
    index("workflow_user_id_idx").on(table.userId),
    // Name scoped to user (namespace isolation).
    uniqueIndex("workflow_user_name_idx").on(table.userId, table.name),
  ],
);

export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;

// ============================================================================
// workflow_field — Workflows (normalized input field definitions)
// ============================================================================
// Normal form: 2NF. Each row defines one input field in the workflow's
// input form. Users fill these before executing.

export const workflowField = pgTable(
  "workflow_field",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    // Client-assigned identifier for template variable binding.
    fieldId: varchar("field_id", { length: 100 }).notNull(),
    // text | image | dropdown | multiline | document
    type: varchar("type", { length: 30 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    placeholder: text("placeholder"),
    isRequired: boolean("is_required").notNull().default(false),
    // JSONB exception: string[] for dropdown options, validated by Zod.
    options: jsonb("options").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List fields for a workflow in order.
    index("workflow_field_workflow_id_idx").on(table.workflowId),
  ],
);

export type WorkflowField = typeof workflowField.$inferSelect;
export type NewWorkflowField = typeof workflowField.$inferInsert;

// ============================================================================
// workflow_step — Workflows (normalized pipeline step definitions)
// ============================================================================
// Normal form: 2NF. inputMappings, overrides, and editorConfig are JSONB
// (opaque config blobs validated by Zod, not relational data).

export const workflowStep = pgTable(
  "workflow_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    // Client-assigned step identifier.
    stepId: varchar("step_id", { length: 100 }).notNull(),
    skillId: uuid("skill_id").references(() => skill.id, {
      onDelete: "set null",
    }),
    skillVersion: integer("skill_version"),
    model: varchar("model", { length: 100 }).notNull().default(""),
    provider: varchar("provider", { length: 50 }),
    prompt: text("prompt").notNull().default(""),
    // JSONB exception: model capability flags.
    capabilities: jsonb("capabilities").notNull().default([]),
    // JSONB exception: step chaining rules {targetField: "step.X.outputKey"}.
    inputMappings: jsonb("input_mappings").notNull().default({}),
    // JSONB exception: runtime overrides {temperature?, maxTokens?, systemPrompt?}.
    overrides: jsonb("overrides").notNull().default({}),
    // JSONB exception: {enabled, model, systemPrompt, maxRounds, approvalMode}.
    editorConfig: jsonb("editor_config"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List steps for a workflow in order.
    index("workflow_step_workflow_id_idx").on(table.workflowId),
    // Lookup by skill (FK index).
    index("workflow_step_skill_id_idx").on(table.skillId),
  ],
);

export type WorkflowStep = typeof workflowStep.$inferSelect;
export type NewWorkflowStep = typeof workflowStep.$inferInsert;

// ============================================================================
// workflow_execution_run — Workflows (completed execution snapshots)
// ============================================================================
// Normal form: 1NF — inputs and step_results are JSONB snapshots of the
// execution state at completion. Not relational; used for history replay.

export const workflowExecutionRun = pgTable(
  "workflow_execution_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // JSONB exception: snapshot of user-provided inputs.
    inputs: jsonb("inputs").notNull(),
    // JSONB exception: StepResult[] array snapshot.
    stepResults: jsonb("step_results").notNull(),
    // completed | failed | partial
    status: text("status").notNull(),
    totalDurationMs: integer("total_duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List runs for a workflow.
    index("workflow_execution_run_workflow_id_idx").on(table.workflowId),
    // List runs by user.
    index("workflow_execution_run_user_id_idx").on(table.userId),
  ],
);

export type WorkflowExecutionRun = typeof workflowExecutionRun.$inferSelect;
export type NewWorkflowExecutionRun = typeof workflowExecutionRun.$inferInsert;

// ============================================================================
// workflow_execution_log — Workflows (per-step telemetry)
// ============================================================================
// Normal form: 2NF. Append-only telemetry — no updated_at.

export const workflowExecutionLog = pgTable(
  "workflow_execution_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowExecutionRun.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id as never),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    stepIndex: integer("step_index").notNull(),
    skillName: text("skill_name"),
    // Snapshot, not FK — skill may be deleted later.
    skillId: uuid("skill_id"),
    model: varchar("model", { length: 100 }),
    provider: varchar("provider", { length: 50 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    // success | error
    status: text("status").notNull(),
    editorRounds: integer("editor_rounds"),
    estimatedCostUsd: numeric("estimated_cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List logs for a run.
    index("workflow_execution_log_run_id_idx").on(table.runId),
    // List logs for a workflow.
    index("workflow_execution_log_workflow_id_idx").on(table.workflowId),
  ],
);

export type WorkflowExecutionLog = typeof workflowExecutionLog.$inferSelect;
export type NewWorkflowExecutionLog = typeof workflowExecutionLog.$inferInsert;

// ============================================================================
// workflow_pending_approval — Workflows (editor loop manual approval queue)
// ============================================================================
// Normal form: 2NF.

export const workflowPendingApproval = pgTable(
  "workflow_pending_approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    stepIndex: integer("step_index").notNull(),
    round: integer("round").notNull(),
    generatorOutput: text("generator_output"),
    editorFeedback: text("editor_feedback"),
    // pending | approved | revised
    status: text("status").notNull().default("pending"),
    userAction: text("user_action"),
    userFeedback: text("user_feedback"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workflow_pending_approval_workflow_id_idx").on(table.workflowId),
    index("workflow_pending_approval_user_id_idx").on(table.userId),
  ],
);

export type WorkflowPendingApproval =
  typeof workflowPendingApproval.$inferSelect;
export type NewWorkflowPendingApproval =
  typeof workflowPendingApproval.$inferInsert;

// ============================================================================
// workflow_exec_token — Workflows (DB-backed SSE execution tokens)
// ============================================================================
// Normal form: 2NF. Single-use tokens for SSE streaming auth.
// Survives deploys (unlike in-memory tokens).

export const workflowExecToken = pgTable(
  "workflow_exec_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).notNull().unique(),
    // JSONB exception: snapshot of user-provided inputs for this execution.
    inputs: jsonb("inputs").notNull(),
    role: varchar("role", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Token lookup.
    index("workflow_exec_token_token_idx").on(table.token),
    // Cleanup expired tokens for a workflow.
    index("workflow_exec_token_workflow_id_idx").on(table.workflowId),
  ],
);

export type WorkflowExecToken = typeof workflowExecToken.$inferSelect;
export type NewWorkflowExecToken = typeof workflowExecToken.$inferInsert;

// ============================================================================
// Relations — Workflows
// ============================================================================

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  user: one(users, {
    fields: [workflow.userId],
    references: [users.id],
  }),
  fields: many(workflowField),
  steps: many(workflowStep),
  executionRuns: many(workflowExecutionRun),
  pendingApprovals: many(workflowPendingApproval),
  execTokens: many(workflowExecToken),
}));

export const workflowFieldRelations = relations(
  workflowField,
  ({ one }) => ({
    workflow: one(workflow, {
      fields: [workflowField.workflowId],
      references: [workflow.id],
    }),
  }),
);

export const workflowStepRelations = relations(workflowStep, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowStep.workflowId],
    references: [workflow.id],
  }),
  skill: one(skill, {
    fields: [workflowStep.skillId],
    references: [skill.id],
  }),
}));

export const workflowExecutionRunRelations = relations(
  workflowExecutionRun,
  ({ one, many }) => ({
    workflow: one(workflow, {
      fields: [workflowExecutionRun.workflowId],
      references: [workflow.id],
    }),
    user: one(users, {
      fields: [workflowExecutionRun.userId],
      references: [users.id],
    }),
    logs: many(workflowExecutionLog),
  }),
);

export const workflowExecutionLogRelations = relations(
  workflowExecutionLog,
  ({ one }) => ({
    run: one(workflowExecutionRun, {
      fields: [workflowExecutionLog.runId],
      references: [workflowExecutionRun.id],
    }),
  }),
);

export const workflowPendingApprovalRelations = relations(
  workflowPendingApproval,
  ({ one }) => ({
    workflow: one(workflow, {
      fields: [workflowPendingApproval.workflowId],
      references: [workflow.id],
    }),
  }),
);

export const workflowExecTokenRelations = relations(
  workflowExecToken,
  ({ one }) => ({
    workflow: one(workflow, {
      fields: [workflowExecToken.workflowId],
      references: [workflow.id],
    }),
    user: one(users, {
      fields: [workflowExecToken.userId],
      references: [users.id],
    }),
  }),
);

// ============================================================================
// skill_execution — Execution tracking for dashboard + journey timeline
// ============================================================================
// Normal form: 2NF. Each row records one skill execution event.
// Does NOT store result content (privacy). For shareable results, see
// execution_share (Phase B).

export const skillExecution = pgTable(
  "skill_execution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    model: varchar("model", { length: 100 }).notNull(),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Dashboard: recent executions by user (ORDER BY created_at DESC).
    index("skill_execution_user_id_idx").on(table.userId),
    // Journey view: executions per skill.
    index("skill_execution_skill_id_idx").on(table.skillId),
  ],
);

export type SkillExecution = typeof skillExecution.$inferSelect;
export type NewSkillExecution = typeof skillExecution.$inferInsert;

export const skillExecutionRelations = relations(
  skillExecution,
  ({ one }) => ({
    user: one(users, {
      fields: [skillExecution.userId],
      references: [users.id],
    }),
    skill: one(skill, {
      fields: [skillExecution.skillId],
      references: [skill.id],
    }),
  }),
);

// ============================================================================
// user_rule — Personalisation rules engine
// ============================================================================

export const userRule = pgTable(
  "user_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    content: text("content").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("user_rule_user_id_idx").on(table.userId)],
);

export type UserRule = typeof userRule.$inferSelect;
export type NewUserRule = typeof userRule.$inferInsert;

export const userRuleRelations = relations(userRule, ({ one }) => ({
  user: one(users, {
    fields: [userRule.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// conversation — Chat (workspace feature)
// ============================================================================
// A persistent AI conversation. Each conversation belongs to one user,
// has an optional system prompt for context, and tracks which OpenRouter
// model is selected. Messages are in a separate normalized table.
//
// Normal form: 2NF. system_prompt is a scalar column (user-authored
// context), not embedded in JSONB.

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull().default("New Chat"),
    model: varchar("model", { length: 100 }).notNull(),
    systemPrompt: text("system_prompt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List conversations by owner, newest first.
    index("conversation_user_id_idx").on(table.userId),
  ],
);

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;

// ============================================================================
// message — Chat messages
// ============================================================================
// Each row is one message in a conversation. role is 'user', 'assistant',
// or 'system'. Assistant messages track which model produced them and
// token usage. is_interrupted marks partial streaming saves.
//
// Normal form: 2NF. content is the raw text (or image URL/base64 for
// image messages). contentType discriminates: 'text' | 'image_url' | 'image_base64'.

export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    contentType: varchar("content_type", { length: 20 }).notNull().default("text"),
    model: varchar("model", { length: 100 }),
    tokens: integer("tokens").default(0),
    isInterrupted: boolean("is_interrupted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Load messages for a conversation.
    index("message_conversation_id_idx").on(table.conversationId),
  ],
);

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;

// ============================================================================
// conversation_share — Shareable conversation snapshots
// ============================================================================
// Snapshot model: content is captured as JSONB at share time. The share
// link is self-contained — deleting the source conversation sets the FK
// to null but the snapshot remains viewable until expiry.
//
// Normal form: 2NF. content is JSONB (permitted under CLAUDE.md exception
// for snapshot/audit payloads). Shape: [{role, content, model, createdAt}].

export const conversationShare = pgTable(
  "conversation_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: uuid("token").notNull().unique().defaultRandom(),
    conversationId: uuid("conversation_id").references(
      () => conversation.id,
      { onDelete: "set null" },
    ),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }),
    content: jsonb("content").notNull(),
    modelUsed: varchar("model_used", { length: 100 }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW() + INTERVAL '30 days'`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Public page lookup by token.
    index("conversation_share_token_idx").on(table.token),
    // List shares by owner.
    index("conversation_share_user_id_idx").on(table.userId),
    // Check if conversation already has a share link.
    index("conversation_share_conversation_id_idx").on(table.conversationId),
  ],
);

export type ConversationShare = typeof conversationShare.$inferSelect;
export type NewConversationShare = typeof conversationShare.$inferInsert;

// ============================================================================
// document — User-owned uploaded documents (Chat Attach Files)
// ============================================================================
// One row per uploaded file, owned by a user. The extracted text is injected
// into a conversation's context; the original bytes live in a PRIVATE R2
// bucket keyed by this row's id (never a public URL — served only through the
// authz'd /file proxy). A document is attached to conversations via the
// conversation_document join, so the same file can be reused across chats
// (reuse-picker UI deferred; v1 attaches 1:1).
//
// Normal form: 2NF. content_hash is a sha-256 hex digest of the bytes (per-user
// dedup key; NOT uniquely constrained in v1 so identical bytes under a new
// filename never silently alias to the old row). extracted_text is a scalar
// column (the injected content), not JSONB.
//
// storage_key is nullable: a failed/unsupported upload (e.g. a scanned PDF)
// records the failure without storing bytes.

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 100 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    // sha-256 hex digest of the raw bytes — per-user dedup key.
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    // Private R2 object key. Null until bytes are stored (or on a failed upload).
    storageKey: text("storage_key"),
    // The extracted text injected into conversation context.
    extractedText: text("extracted_text"),
    charCount: integer("char_count").notNull().default(0),
    // 'processing' | 'ready' | 'failed' | 'unsupported'
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    // 'scanned_pdf' | 'too_large' | 'extract_failed' | 'unsupported_type'
    errorReason: text("error_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // List a user's documents, newest first (owner scope + reuse picker).
    index("document_user_id_idx").on(table.userId),
    // Per-user dedup lookup by content hash. NON-unique in v1 (see #7): we do
    // not dedup-attach in v1, so identical bytes never alias to a stale filename.
    index("document_user_id_content_hash_idx").on(
      table.userId,
      table.contentHash,
    ),
  ],
);

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;

// ============================================================================
// conversation_document — which documents are attached to which conversation
// ============================================================================
// Junction between conversation and document (both entity names, alphabetical
// per naming standard). A document attaches once per conversation. Deleting a
// conversation CASCADEs these join rows only; the document (and its R2 object)
// is cleaned up separately by the app when its ref-count hits zero — Postgres
// cannot delete R2 objects.
//
// Normal form: 2NF. No non-key attributes beyond created_at.

export const conversationDocument = pgTable(
  "conversation_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Load a conversation's attached documents (the injection hot path).
    index("conversation_document_conversation_id_idx").on(table.conversationId),
    // Reverse lookup: which conversations reference a document (ref-count).
    index("conversation_document_document_id_idx").on(table.documentId),
    // A document attaches at most once per conversation.
    uniqueIndex("conversation_document_conversation_id_document_id_key").on(
      table.conversationId,
      table.documentId,
    ),
  ],
);

export type ConversationDocument = typeof conversationDocument.$inferSelect;
export type NewConversationDocument = typeof conversationDocument.$inferInsert;

// Relations for chat tables

export const conversationRelations = relations(
  conversation,
  ({ one, many }) => ({
    user: one(users, {
      fields: [conversation.userId],
      references: [users.id],
    }),
    messages: many(message),
    shares: many(conversationShare),
  }),
);

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
}));

export const conversationShareRelations = relations(
  conversationShare,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationShare.conversationId],
      references: [conversation.id],
    }),
    user: one(users, {
      fields: [conversationShare.userId],
      references: [users.id],
    }),
  }),
);

// ============================================================================
// social_account — Per-user social platform connections
// ============================================================================
// Stores OAuth tokens (Twitter, LinkedIn) and AT Protocol app passwords
// (Bluesky) for social publishing. Tokens are encrypted at the application
// layer via lib/booking-crypto.ts (AES-256-GCM), not at the DB level.
//
// Normal form: 2NF. Every non-key column depends only on the PK.
// OLTP table. One account per user per platform for v1.

export const socialAccount = pgTable(
  "social_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    providerSubject: text("provider_subject").notNull(),
    accountIdentifier: text("account_identifier").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    isConnected: boolean("is_connected").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK index: list social accounts by user
    index("social_account_user_id_idx").on(table.userId),
    // One account per user per platform for v1
    unique("social_account_user_platform_uniq").on(
      table.userId,
      table.platform,
    ),
  ],
);

export type SocialAccount = typeof socialAccount.$inferSelect;
export type NewSocialAccount = typeof socialAccount.$inferInsert;

// ============================================================================
// publish_log — Social media publish history
// ============================================================================
// Records every publish attempt for audit, dedup, and "recent publishes" UI.
//
// Normal form: 2NF. publishedContent is JSONB (permitted under CLAUDE.md
// exception for audit payloads). Shape: {text: string, url?: string}.

export const publishLog = pgTable(
  "publish_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccount.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    contentPreview: varchar("content_preview", { length: 500 }).notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    publishedUrl: text("published_url"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // FK index: list publishes by user
    index("publish_log_user_id_idx").on(table.userId),
    // FK index: list publishes by social account
    index("publish_log_social_account_id_idx").on(table.socialAccountId),
    // Timeline view: recent publishes sorted by date
    index("publish_log_created_at_idx").on(table.createdAt),
    // Dedup check: same content to same platform within 60s
    index("publish_log_content_hash_platform_idx").on(
      table.contentHash,
      table.platform,
    ),
  ],
);

export type PublishLog = typeof publishLog.$inferSelect;
export type NewPublishLog = typeof publishLog.$inferInsert;

// Relations for social tables

export const socialAccountRelations = relations(
  socialAccount,
  ({ one, many }) => ({
    user: one(users, {
      fields: [socialAccount.userId],
      references: [users.id],
    }),
    publishLogs: many(publishLog),
  }),
);

export const publishLogRelations = relations(publishLog, ({ one }) => ({
  user: one(users, {
    fields: [publishLog.userId],
    references: [users.id],
  }),
  socialAccount: one(socialAccount, {
    fields: [publishLog.socialAccountId],
    references: [socialAccount.id],
  }),
}));

// ---------------------------------------------------------------------------
// scheduled_social_post — queue for deferred social publishes
// ---------------------------------------------------------------------------

export const scheduledSocialPost = pgTable(
  "scheduled_social_post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    content: text("content").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    displayTimezone: text("display_timezone").notNull(),
    status: text("status").notNull().default("pending"),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scheduled_social_post_status_scheduled_for_idx").on(
      table.status,
      table.scheduledFor,
    ),
    index("scheduled_social_post_user_id_idx").on(table.userId),
    index("scheduled_social_post_user_status_idx").on(
      table.userId,
      table.status,
    ),
  ],
);

export type ScheduledSocialPost = typeof scheduledSocialPost.$inferSelect;
export type NewScheduledSocialPost = typeof scheduledSocialPost.$inferInsert;

export const scheduledSocialPostRelations = relations(
  scheduledSocialPost,
  ({ one }) => ({
    user: one(users, {
      fields: [scheduledSocialPost.userId],
      references: [users.id],
    }),
  }),
);

// ============================================================================
// ORG / PROJECTS / CLIENTS / KANBAN — consulting delivery (ported from Spresso)
// ============================================================================
// Multi-tenant org layer + consulting CRM + project Kanban. Reduced port:
// drops Spresso flows/content-items/voting. All FKs indexed (CLAUDE.md).
// Org read-visibility model lives in lib/auth/org-context.ts, not here.
// ============================================================================

// organisation — the tenant. join_key is a bearer invite secret (20-byte hex).
export const organisation = pgTable(
  "organisation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    description: text("description"),
    logoUrl: text("logo_url"),
    // Bearer invite key (crypto.randomBytes(20).toString('hex') = 40 chars).
    joinKey: varchar("join_key", { length: 64 }).notNull().unique(),
    // Owner is a user; set null on user delete so the org row survives for audit.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Look up an org by its owner (default-org guard + "my orgs").
    index("organisation_owner_id_idx").on(table.ownerId),
  ],
);
export type Organisation = typeof organisation.$inferSelect;
export type NewOrganisation = typeof organisation.$inferInsert;

// organisation_member — junction: which users belong to an org and their role.
// role is resolved per (user, org) — NEVER a global users.role for org context.
export const organisationMember = pgTable(
  "organisation_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'owner' | 'admin' | 'member' — enforced in lib/auth/org-context.ts.
    role: varchar("role", { length: 20 }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One membership row per (user, org). Also the conflict target for the
    // idempotent default-org backfill (ON CONFLICT DO NOTHING).
    uniqueIndex("organisation_member_org_user_idx").on(
      table.organisationId,
      table.userId,
    ),
    // List members of an org; list a user's orgs.
    index("organisation_member_org_id_idx").on(table.organisationId),
    index("organisation_member_user_id_idx").on(table.userId),
  ],
);
export type OrganisationMember = typeof organisationMember.$inferSelect;
export type NewOrganisationMember = typeof organisationMember.$inferInsert;

// client — a consulting client, scoped to an org.
export const client = pgTable(
  "client",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    industry: varchar("industry", { length: 100 }),
    website: varchar("website", { length: 500 }),
    companySize: varchar("company_size", { length: 50 }),
    abnTaxId: varchar("abn_tax_id", { length: 50 }),
    addressLine1: varchar("address_line1", { length: 255 }),
    addressLine2: varchar("address_line2", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 100 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 100 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("client_organisation_id_idx").on(table.organisationId)],
);
export type Client = typeof client.$inferSelect;
export type NewClient = typeof client.$inferInsert;

// client_contact — a person at a client.
export const clientContact = pgTable(
  "client_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    role: varchar("role", { length: 100 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("client_contact_client_id_idx").on(table.clientId)],
);
export type ClientContact = typeof clientContact.$inferSelect;
export type NewClientContact = typeof clientContact.$inferInsert;

// client_contract — an engagement/contract for a client.
export const clientContract = pgTable(
  "client_contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    contractType: varchar("contract_type", { length: 50 }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    billingRate: numeric("billing_rate", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("client_contract_client_id_idx").on(table.clientId)],
);
export type ClientContract = typeof clientContract.$inferSelect;
export type NewClientContract = typeof clientContract.$inferInsert;

// contract_attachment — files attached to a client contract (Cloudinary-backed).
// Scoped to the org through the contract's client (see lib/contract-attachments).
export const clientContractAttachment = pgTable(
  "contract_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => clientContract.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileType: varchar("file_type", { length: 100 }),
    fileSize: integer("file_size"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contract_attachment_contract_id_idx").on(table.contractId),
  ],
);
export type ClientContractAttachment =
  typeof clientContractAttachment.$inferSelect;
export type NewClientContractAttachment =
  typeof clientContractAttachment.$inferInsert;

// project — a unit of work, scoped to an org, optionally tied to a client.
export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    // Creator. set null on user delete so the project survives.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("project_organisation_id_idx").on(table.organisationId),
    index("project_client_id_idx").on(table.clientId),
    index("project_user_id_idx").on(table.userId),
  ],
);
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;

// project_member — junction: which users are on a project.
export const projectMember = pgTable(
  "project_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_member_project_user_idx").on(
      table.projectId,
      table.userId,
    ),
    index("project_member_project_id_idx").on(table.projectId),
    index("project_member_user_id_idx").on(table.userId),
  ],
);
export type ProjectMember = typeof projectMember.$inferSelect;
export type NewProjectMember = typeof projectMember.$inferInsert;

// project_activity — append-only timeline + audit trail (expansion D3.1).
export const projectActivity = pgTable(
  "project_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    entityName: varchar("entity_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Paginated feed: activity for a project, newest first.
    index("project_activity_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);
export type ProjectActivity = typeof projectActivity.$inferSelect;
export type NewProjectActivity = typeof projectActivity.$inferInsert;

// kanban_column — a board column within a project.
export const kanbanColumn = pgTable(
  "kanban_column",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kanban_column_project_id_idx").on(table.projectId)],
);
export type KanbanColumn = typeof kanbanColumn.$inferSelect;
export type NewKanbanColumn = typeof kanbanColumn.$inferInsert;

// kanban_card — a card within a column. artifact_* links to a workspace
// artifact (expansion D3.3); cover_image_url + attachments use lib/r2.ts.
export const kanbanCard = pgTable(
  "kanban_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    columnId: uuid("column_id")
      .notNull()
      .references(() => kanbanColumn.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    priority: varchar("priority", { length: 20 }).notNull().default("medium"),
    dueDate: date("due_date", { mode: "string" }),
    sortOrder: integer("sort_order").notNull().default(0),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    coverImageUrl: text("cover_image_url"),
    // Workspace-artifact link (D3.3): 'workflow_run' | 'image' | 'conversation'.
    artifactType: varchar("artifact_type", { length: 30 }),
    artifactId: uuid("artifact_id"),
    artifactUrl: text("artifact_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Board fetch: cards for a project ordered within columns (N+1-safe).
    index("kanban_card_project_column_sort_idx").on(
      table.projectId,
      table.columnId,
      table.sortOrder,
    ),
    index("kanban_card_column_id_idx").on(table.columnId),
    index("kanban_card_assignee_id_idx").on(table.assigneeId),
  ],
);
export type KanbanCard = typeof kanbanCard.$inferSelect;
export type NewKanbanCard = typeof kanbanCard.$inferInsert;

// kanban_card_comment — a comment on a card.
export const kanbanCardComment = pgTable(
  "kanban_card_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => kanbanCard.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kanban_card_comment_card_id_idx").on(table.cardId)],
);
export type KanbanCardComment = typeof kanbanCardComment.$inferSelect;
export type NewKanbanCardComment = typeof kanbanCardComment.$inferInsert;

// kanban_card_attachment — a file on a card (stored in R2 via lib/r2.ts).
export const kanbanCardAttachment = pgTable(
  "kanban_card_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => kanbanCard.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileType: varchar("file_type", { length: 100 }),
    fileSize: integer("file_size"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kanban_card_attachment_card_id_idx").on(table.cardId)],
);
export type KanbanCardAttachment = typeof kanbanCardAttachment.$inferSelect;
export type NewKanbanCardAttachment = typeof kanbanCardAttachment.$inferInsert;

// card_label — a label definition within a project.
export const cardLabel = pgTable(
  "card_label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("card_label_project_id_idx").on(table.projectId)],
);
export type CardLabel = typeof cardLabel.$inferSelect;
export type NewCardLabel = typeof cardLabel.$inferInsert;

// card_label_assignment — junction: labels applied to cards (composite key).
export const cardLabelAssignment = pgTable(
  "card_label_assignment",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => kanbanCard.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => cardLabel.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite identity: one assignment per (card, label).
    uniqueIndex("card_label_assignment_card_label_idx").on(
      table.cardId,
      table.labelId,
    ),
    // Reverse lookup: which cards have a label.
    index("card_label_assignment_label_id_idx").on(table.labelId),
  ],
);
export type CardLabelAssignment = typeof cardLabelAssignment.$inferSelect;
export type NewCardLabelAssignment = typeof cardLabelAssignment.$inferInsert;

// ============================================================================
// data_model — Model Studio (migrated from Spresso)
// ============================================================================
// A data model lives inside a project; the organisation is derived via
// project.organisation_id, so no org column is denormalised here. Owned by
// the user who created it. activeLayer/notation/originDirection are
// render/intent state for the (future) canvas; metadata/tags are open-ended
// JSONB envelopes validated by Zod at the application layer.
export const dataModel = pgTable(
  "data_model",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    // Creator/owner. Cascade so a user's models go with them on delete.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    // Last layer the user viewed: conceptual | logical | physical.
    activeLayer: varchar("active_layer", { length: 20 })
      .notNull()
      .default("conceptual"),
    // Notation preference: ie | idef1x (render-only, not data).
    notation: varchar("notation", { length: 20 }).notNull().default("ie"),
    // Modelling direction at creation: greenfield | existing_system.
    originDirection: varchar("origin_direction", { length: 20 })
      .notNull()
      .default("greenfield"),
    metadata: jsonb("metadata").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    // Soft milestone: when DDL was last exported (null = never).
    lastExportedAt: timestamp("last_exported_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One model name per (project, owner) pair — two projects can each own
    // a "Customer Domain" model without conflict.
    uniqueIndex("data_model_project_owner_name_idx").on(
      table.projectId,
      table.ownerId,
      table.name,
    ),
    // List models for a project (the Model Studio list view).
    index("data_model_project_id_idx").on(table.projectId),
    // List models owned by a user (global / profile view).
    index("data_model_owner_id_idx").on(table.ownerId),
  ],
);
export type DataModel = typeof dataModel.$inferSelect;
export type NewDataModel = typeof dataModel.$inferInsert;

// ============================================================================
// data_model_entity — Model Studio canvas (migrated from Spresso)
// ============================================================================
// An entity is a box on the canvas inside a data model. It carries its own
// layer (conceptual|logical|physical) so the canvas can render one layer at a
// time. display_id (E001, E002, …) is a monotonic per-model label assigned at
// creation. version is an optimistic lock — PATCH bumps it; a stale PATCH 409s.
// Position/viewport are NOT stored here — they live in data_model_canvas_state,
// scoped per user + layer, so the entity row stays pure model data.
export const dataModelEntity = pgTable(
  "data_model_entity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataModelId: uuid("data_model_id")
      .notNull()
      .references(() => dataModel.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    businessName: varchar("business_name", { length: 255 }),
    description: text("description"),
    // standard | associative | subtype | supertype.
    entityType: varchar("entity_type", { length: 50 })
      .notNull()
      .default("standard"),
    // conceptual | logical | physical.
    layer: varchar("layer", { length: 20 }).notNull(),
    // E001, E002, … monotonic per model, assigned in a transaction.
    displayId: varchar("display_id", { length: 10 }),
    // Per-alternate-key-group labels, e.g. { "AK1": "NI number" }.
    altKeyLabels: jsonb("alt_key_labels").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    // Optimistic lock for concurrent PATCH.
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One entity name per model — surfaces a 409 on collision.
    uniqueIndex("data_model_entity_model_name_idx").on(
      table.dataModelId,
      table.name,
    ),
    // Monotonic display id is unique within a model; also serves lookup by E-id.
    uniqueIndex("data_model_entity_model_display_id_idx").on(
      table.dataModelId,
      table.displayId,
    ),
    // List entities for a model (the canvas load).
    index("data_model_entity_data_model_id_idx").on(table.dataModelId),
  ],
);
export type DataModelEntity = typeof dataModelEntity.$inferSelect;
export type NewDataModelEntity = typeof dataModelEntity.$inferInsert;

// ============================================================================
// data_model_attribute — Model Studio canvas (migrated from Spresso)
// ============================================================================
// An attribute is a column inside an entity. ordinal_position orders them
// within the entity (reorder swaps two rows atomically). The boolean flags and
// classification drive the canvas key/FK glyphs. version is the optimistic lock.
export const dataModelAttribute = pgTable(
  "data_model_attribute",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalised model id (alongside entity_id) so the canvas can batch-load
    // every attribute for a model in one query without joining through entity.
    dataModelId: uuid("data_model_id")
      .notNull()
      .references(() => dataModel.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => dataModelEntity.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    // Postgres-native type name: uuid, varchar, integer, text, numeric, …
    dataType: varchar("data_type", { length: 100 }),
    // e.g. { precision: 18, scale: 2 } for numeric(18,2).
    dataTypeParams: jsonb("data_type_params"),
    ordinalPosition: integer("ordinal_position").notNull(),
    isPrimaryKey: boolean("is_primary_key").notNull().default(false),
    isNullable: boolean("is_nullable").notNull().default(true),
    isUnique: boolean("is_unique").notNull().default(false),
    isForeignKey: boolean("is_foreign_key").notNull().default(false),
    // Governance/sensitivity classification (DMBOK + compliance categories):
    // PII | PCI | PHI | Financial | Confidential | Restricted | Internal | Public.
    // Nullable — null means "no classification set" (the default). Validated at
    // the application layer; the column is a plain varchar so the list can
    // evolve without a migration. Structural role lives in the boolean flags.
    classification: varchar("classification", { length: 50 }),
    // AK1, AK2, … alternate-key-group membership (null = none).
    altKeyGroup: varchar("alt_key_group", { length: 10 }),
    defaultValue: text("default_value"),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default({}),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One attribute name per entity — surfaces a 409 on collision.
    uniqueIndex("data_model_attribute_entity_name_idx").on(
      table.entityId,
      table.name,
    ),
    // List attributes for an entity (ordered render in the entity node).
    index("data_model_attribute_entity_id_idx").on(table.entityId),
    // Batch-load all attributes for a model (canvas preload).
    index("data_model_attribute_data_model_id_idx").on(table.dataModelId),
  ],
);
export type DataModelAttribute = typeof dataModelAttribute.$inferSelect;
export type NewDataModelAttribute = typeof dataModelAttribute.$inferInsert;

// ============================================================================
// data_model_relationship — Model Studio canvas (migrated from Spresso)
// ============================================================================
// A relationship is an edge between two entities in the same model. Cardinality
// and verb phrases drive the IE/IDEF1X glyphs; waypoints persist user-authored
// edge routing. Both endpoints are validated to belong to the same model at the
// service layer. version is the optimistic lock.
export const dataModelRelationship = pgTable(
  "data_model_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataModelId: uuid("data_model_id")
      .notNull()
      .references(() => dataModel.id, { onDelete: "cascade" }),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => dataModelEntity.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => dataModelEntity.id, { onDelete: "cascade" }),
    // Forward verb phrase, e.g. "manages".
    name: varchar("name", { length: 128 }),
    // Inverse verb phrase, e.g. "is_managed_by".
    nameInverse: varchar("name_inverse", { length: 128 }),
    // 0..1 | 1..1 | 0..* | 1..* (validated at the application layer).
    sourceCardinality: varchar("source_cardinality", { length: 20 }).notNull(),
    targetCardinality: varchar("target_cardinality", { length: 20 }).notNull(),
    isIdentifying: boolean("is_identifying").notNull().default(false),
    isNullableForeignKey: boolean("is_nullable_foreign_key")
      .notNull()
      .default(false),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default({}),
    // [{ x, y }, …] user-authored waypoints for edge routing.
    waypoints: jsonb("waypoints"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // List relationships for a model (the canvas load).
    index("data_model_relationship_data_model_id_idx").on(table.dataModelId),
    // Find edges touching an entity (cascade preview, redraw on entity move).
    index("data_model_relationship_source_entity_id_idx").on(
      table.sourceEntityId,
    ),
    index("data_model_relationship_target_entity_id_idx").on(
      table.targetEntityId,
    ),
  ],
);
export type DataModelRelationship = typeof dataModelRelationship.$inferSelect;
export type NewDataModelRelationship = typeof dataModelRelationship.$inferInsert;

// ============================================================================
// data_model_canvas_state — Model Studio canvas (migrated from Spresso)
// ============================================================================
// Per-user, per-layer view state for a model: where each entity node sits, the
// viewport, and the notation preference. One row per (model, user, layer) —
// last-write-wins (no version column), because this is ephemeral UI state, not
// authored model data.
export const dataModelCanvasState = pgTable(
  "data_model_canvas_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataModelId: uuid("data_model_id")
      .notNull()
      .references(() => dataModel.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    layer: varchar("layer", { length: 20 }).notNull(),
    // { [entityId]: { x, y }, … }
    nodePositions: jsonb("node_positions").notNull().default({}),
    viewport: jsonb("viewport")
      .notNull()
      .default({ x: 0, y: 0, zoom: 1 }),
    // ie | idef1x (per-user render preference).
    notation: varchar("notation", { length: 10 }).notNull().default("ie"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One canvas state per user per model per layer — the upsert key.
    uniqueIndex("data_model_canvas_state_model_user_layer_idx").on(
      table.dataModelId,
      table.userId,
      table.layer,
    ),
    // List canvas states for a model (e.g. cleanup on model delete).
    index("data_model_canvas_state_data_model_id_idx").on(table.dataModelId),
  ],
);
export type DataModelCanvasState = typeof dataModelCanvasState.$inferSelect;
export type NewDataModelCanvasState = typeof dataModelCanvasState.$inferInsert;

// ============================================================================
// content_plan_item — Blog writer agent
// ============================================================================
// The work queue the daily blog agent pulls from. OLTP, 2NF: every non-key
// column depends only on the id.
//
//   plan.ts inserts a batch
//          │
//          ▼
//     ┌─ pending ◀──────────── sweeper (locked_until elapsed, attempts+1)
//     │      │ claim: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE, ONE txn
//     │      ▼                 (copied from lib/scheduler.ts:160 — NOT from
//     │   running               scheduled-publisher, which releases its lock
//     │      │                  before the work starts)
//     │      ├──▶ drafted  (terminal — post created, awaiting human review)
//     │      ├──▶ skipped  (terminal — duplicate topic)
//     │      └──▶ failed   (terminal at attempts >= 3)
//     └──────────┘
//
// There is deliberately NO `published` status and NO FK to
// workflow_execution_run:
//   - Live state is derived by joining `post`; the scheduled publisher owns
//     post.status, so one writer per column.
//   - workflow_execution_run is pruned to 22 rows per workflow by pruneRuns
//     (lib/workflows/runs.ts), and that DELETE runs inside a swallowed
//     catch{} in executor.ts. An FK here would make pruning throw, get
//     swallowed, and silently stop forever while step_results grew unbounded.
export const contentPlanItem = pgTable(
  "content_plan_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Groups one research batch from plan.ts.
    batchId: uuid("batch_id").notNull(),
    // Position within the batch; also the dequeue order.
    dayNumber: integer("day_number").notNull(),
    title: text("title").notNull(),
    // 'long' | 'short' — maps to the workflow's word-count dropdown.
    format: text("format").notNull(),
    // Structural variance hint so 70 posts don't share one skeleton
    // (Google names near-identical structure as a scaled-content signal).
    shape: text("shape"),
    categoryId: uuid("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    topic: text("topic").notNull(),
    audience: text("audience").notNull(),
    action: text("action").notNull(),
    // A real observation supplied by a human. When present the gate permits
    // first-person narration that traces to it; when NULL, episodic first
    // person is always a hard failure. This is the honest replacement for the
    // first-hand-experience signal given up by forbidding invented anecdotes.
    fieldNote: text("field_note"),
    // pending | running | drafted | failed | skipped
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    postId: uuid("post_id").references(() => post.id, { onDelete: "set null" }),
    // Audit only: the gate + judge findings per round, so a rejection can be
    // explained after the fact. JSONB exception per the CLAUDE.md DB
    // standards (audit/metadata column, not a relational one).
    judgeVerdict: jsonb("judge_verdict"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The dequeue, run every cron tick: "next pending item in batch order".
    index("content_plan_item_status_day_number_idx").on(
      table.status,
      table.dayNumber,
    ),
    // FK index (mandatory per CLAUDE.md): "items in this category".
    index("content_plan_item_category_id_idx").on(table.categoryId),
    // FK index (mandatory per CLAUDE.md): "which item produced this post".
    index("content_plan_item_post_id_idx").on(table.postId),
    // "List one batch" — the admin pipeline view.
    index("content_plan_item_batch_id_idx").on(table.batchId),
  ],
);

export type ContentPlanItem = typeof contentPlanItem.$inferSelect;
export type NewContentPlanItem = typeof contentPlanItem.$inferInsert;
