import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  boolean,
  integer,
  index,
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
