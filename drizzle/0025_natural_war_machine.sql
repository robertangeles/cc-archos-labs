-- Migration 0025 — Org / Projects / Clients / Kanban (consulting delivery)
-- Hardened for scripts/db-apply.mjs (non-transactional, marker-at-end):
-- every statement is idempotent so a partial-failure re-run is safe.
-- Additive only: 14 NEW tables. No changes to existing tables (the org_id
-- backfill on existing tables is a separate, gated cutover migration).
CREATE TABLE IF NOT EXISTS "card_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_label_assignment" (
	"card_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"industry" varchar(100),
	"website" varchar(500),
	"company_size" varchar(50),
	"abn_tax_id" varchar(50),
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"postal_code" varchar(20),
	"country" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"role" varchar(100),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contract_type" varchar(50),
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"billing_rate" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kanban_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"column_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"assignee_id" uuid,
	"cover_image_url" text,
	"artifact_type" varchar(30),
	"artifact_id" uuid,
	"artifact_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kanban_card_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(100),
	"file_size" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kanban_card_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kanban_column" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"logo_url" text,
	"join_key" varchar(64) NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organisation_join_key_unique" UNIQUE("join_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisation_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid,
	"user_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"entity_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "card_label" ADD CONSTRAINT "card_label_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "card_label_assignment" ADD CONSTRAINT "card_label_assignment_card_id_kanban_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kanban_card"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "card_label_assignment" ADD CONSTRAINT "card_label_assignment_label_id_card_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."card_label"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client" ADD CONSTRAINT "client_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_contract" ADD CONSTRAINT "client_contract_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card" ADD CONSTRAINT "kanban_card_column_id_kanban_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."kanban_column"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card" ADD CONSTRAINT "kanban_card_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card" ADD CONSTRAINT "kanban_card_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card_attachment" ADD CONSTRAINT "kanban_card_attachment_card_id_kanban_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kanban_card"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card_attachment" ADD CONSTRAINT "kanban_card_attachment_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card_comment" ADD CONSTRAINT "kanban_card_comment_card_id_kanban_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kanban_card"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_card_comment" ADD CONSTRAINT "kanban_card_comment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "kanban_column" ADD CONSTRAINT "kanban_column_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "organisation" ADD CONSTRAINT "organisation_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "organisation_member" ADD CONSTRAINT "organisation_member_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "organisation_member" ADD CONSTRAINT "organisation_member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project" ADD CONSTRAINT "project_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project" ADD CONSTRAINT "project_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project" ADD CONSTRAINT "project_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_label_project_id_idx" ON "card_label" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_label_assignment_card_label_idx" ON "card_label_assignment" USING btree ("card_id","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_label_assignment_label_id_idx" ON "card_label_assignment" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_organisation_id_idx" ON "client" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contact_client_id_idx" ON "client_contact" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contract_client_id_idx" ON "client_contract" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_card_project_column_sort_idx" ON "kanban_card" USING btree ("project_id","column_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_card_column_id_idx" ON "kanban_card" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_card_assignee_id_idx" ON "kanban_card" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_card_attachment_card_id_idx" ON "kanban_card_attachment" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_card_comment_card_id_idx" ON "kanban_card_comment" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanban_column_project_id_idx" ON "kanban_column" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organisation_owner_id_idx" ON "organisation" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organisation_member_org_user_idx" ON "organisation_member" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organisation_member_org_id_idx" ON "organisation_member" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organisation_member_user_id_idx" ON "organisation_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_organisation_id_idx" ON "project" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_client_id_idx" ON "project" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_user_id_idx" ON "project" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_activity_project_created_idx" ON "project_activity" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_member_project_user_idx" ON "project_member" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_project_id_idx" ON "project_member" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_user_id_idx" ON "project_member" USING btree ("user_id");
