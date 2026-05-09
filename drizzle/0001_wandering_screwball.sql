CREATE TABLE "assessment_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scores" jsonb,
	"tier" text,
	"risk_flags" jsonb,
	"ip_address" text,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"job_title" text,
	"organisation" text,
	"phone" text,
	"is_priority" boolean DEFAULT false NOT NULL,
	"crm_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "report_output" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_session_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"narrative" text NOT NULL,
	"action_plan" jsonb NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_output_assessment_session_id_unique" UNIQUE("assessment_session_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_session" ADD CONSTRAINT "assessment_session_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_output" ADD CONSTRAINT "report_output_assessment_session_id_assessment_session_id_fk" FOREIGN KEY ("assessment_session_id") REFERENCES "public"."assessment_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_session_lead_id_idx" ON "assessment_session" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "assessment_session_status_idx" ON "assessment_session" USING btree ("status");