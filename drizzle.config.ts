import type { Config } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL from the process env. Use:
//   pnpm db:push    (loads .env.local via --env-file)
//   pnpm db:studio  (same)
// On Render the env var is injected by the platform.

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
    // Local dev Postgres (127.0.0.1) has no SSL; Render requires it.
    ssl: /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(
      process.env.DATABASE_URL ?? "",
    )
      ? false
      : { rejectUnauthorized: false },
  },
  verbose: true,
  strict: false,
  extensionsFilters: ["postgis"],
  tablesFilter: [
    "site_setting",
    "integration_secret_audit",
    "lead",
    "assessment_session",
    "report_output",
    "newsletter_signup",
    "booking_request",
    "share_token",
    "cron_heartbeat",
    "consultant",
    "consultant_blackout",
    "scheduled_job",
    "post",
    "post_revision",
    "author",
    "category",
    "page",
    "page_block",
    "page_revision",
    "knowledge_document",
    "knowledge_chunk",
    "users",
    "user_session",
    "auth_event",
    "auth_setting",
    "oauth_account",
    "magic_link_token",
    "cdmp_exam_session",
    "cdmp_exam_answer",
    "cdmp_question_flag",
    "skill",
    "user_rule",
    "conversation",
    "message",
    "conversation_share",
  ],
} satisfies Config;
