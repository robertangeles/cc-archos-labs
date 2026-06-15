CREATE TABLE IF NOT EXISTS "data_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"active_layer" varchar(20) DEFAULT 'conceptual' NOT NULL,
	"notation" varchar(20) DEFAULT 'ie' NOT NULL,
	"origin_direction" varchar(20) DEFAULT 'greenfield' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_exported_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model" ADD CONSTRAINT "data_model_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model" ADD CONSTRAINT "data_model_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_model_project_owner_name_idx" ON "data_model" USING btree ("project_id","owner_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_project_id_idx" ON "data_model" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_owner_id_idx" ON "data_model" USING btree ("owner_id");
