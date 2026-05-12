CREATE TABLE "booking_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organisation" text,
	"position" text,
	"reason_initial" text NOT NULL,
	"reason_followups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"prospect_timezone" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"google_event_id" text,
	"meet_url" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"referrer" text,
	"attribution_extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reschedule_jti" text,
	"cancel_jti" text,
	"precall_brief_sent_at" timestamp with time zone,
	"reminder_24h_sent_at" timestamp with time zone,
	"reminder_1h_sent_at" timestamp with time zone,
	"postcall_followup_sent_at" timestamp with time zone,
	"noshow_recovery_sent_at" timestamp with time zone,
	"rescheduled_to_id" uuid,
	"idempotency_key" text NOT NULL,
	"claude_cost_usd_total" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_request_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "consultant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"slot_buffer_minutes" integer DEFAULT 15 NOT NULL,
	"advance_days" integer DEFAULT 14 NOT NULL,
	"min_notice_hours" integer DEFAULT 24 NOT NULL,
	"working_hours_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"google_refresh_token_encrypted" text,
	"google_calendar_id" text,
	"google_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultant_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "consultant_blackout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultant_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_run_jobs_processed" integer DEFAULT 0 NOT NULL,
	"last_run_jobs_failed" integer DEFAULT 0 NOT NULL,
	"last_run_duration_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"last_error" text,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"claude_cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_rescheduled_to_id_booking_request_id_fk" FOREIGN KEY ("rescheduled_to_id") REFERENCES "public"."booking_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_blackout" ADD CONSTRAINT "consultant_blackout_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_job" ADD CONSTRAINT "scheduled_job_booking_id_booking_request_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_request_consultant_id_slot_start_idx" ON "booking_request" USING btree ("consultant_id","slot_start");--> statement-breakpoint
CREATE INDEX "booking_request_email_idx" ON "booking_request" USING btree ("email");--> statement-breakpoint
CREATE INDEX "booking_request_status_idx" ON "booking_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consultant_blackout_consultant_id_start_at_idx" ON "consultant_blackout" USING btree ("consultant_id","start_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_status_due_at_idx" ON "scheduled_job" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_booking_id_idx" ON "scheduled_job" USING btree ("booking_id");