CREATE TABLE "skill_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"model" varchar(100) NOT NULL,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"style" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_exec_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"inputs" jsonb NOT NULL,
	"role" varchar(50),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_exec_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid,
	"step_index" integer NOT NULL,
	"skill_name" text,
	"skill_id" uuid,
	"model" varchar(100),
	"provider" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"status" text NOT NULL,
	"editor_rounds" integer,
	"estimated_cost_usd" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid,
	"inputs" jsonb NOT NULL,
	"step_results" jsonb NOT NULL,
	"status" text NOT NULL,
	"total_duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"field_id" varchar(100) NOT NULL,
	"type" varchar(30) NOT NULL,
	"label" varchar(255) NOT NULL,
	"placeholder" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_pending_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid,
	"step_index" integer NOT NULL,
	"round" integer NOT NULL,
	"generator_output" text,
	"editor_feedback" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_action" text,
	"user_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_id" varchar(100) NOT NULL,
	"skill_id" uuid,
	"skill_version" integer,
	"model" varchar(100) DEFAULT '' NOT NULL,
	"provider" varchar(50),
	"prompt" text DEFAULT '' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"editor_config" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_execution" ADD CONSTRAINT "skill_execution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_execution" ADD CONSTRAINT "skill_execution_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rule" ADD CONSTRAINT "user_rule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_exec_token" ADD CONSTRAINT "workflow_exec_token_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_exec_token" ADD CONSTRAINT "workflow_exec_token_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_log" ADD CONSTRAINT "workflow_execution_log_run_id_workflow_execution_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_execution_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_log" ADD CONSTRAINT "workflow_execution_log_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_log" ADD CONSTRAINT "workflow_execution_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_run" ADD CONSTRAINT "workflow_execution_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_run" ADD CONSTRAINT "workflow_execution_run_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_field" ADD CONSTRAINT "workflow_field_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pending_approval" ADD CONSTRAINT "workflow_pending_approval_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_pending_approval" ADD CONSTRAINT "workflow_pending_approval_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_execution_user_id_idx" ON "skill_execution" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_execution_skill_id_idx" ON "skill_execution" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "user_rule_user_id_idx" ON "user_rule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_user_id_idx" ON "workflow" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_user_name_idx" ON "workflow" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "workflow_exec_token_token_idx" ON "workflow_exec_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "workflow_exec_token_workflow_id_idx" ON "workflow_exec_token" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_log_run_id_idx" ON "workflow_execution_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_log_workflow_id_idx" ON "workflow_execution_log" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_run_workflow_id_idx" ON "workflow_execution_run" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_run_user_id_idx" ON "workflow_execution_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_field_workflow_id_idx" ON "workflow_field" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_pending_approval_workflow_id_idx" ON "workflow_pending_approval" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_pending_approval_user_id_idx" ON "workflow_pending_approval" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_step_workflow_id_idx" ON "workflow_step" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_step_skill_id_idx" ON "workflow_step" USING btree ("skill_id");