CREATE TABLE IF NOT EXISTS "data_model_attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_model_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"data_type" varchar(100),
	"data_type_params" jsonb,
	"ordinal_position" integer NOT NULL,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"is_nullable" boolean DEFAULT true NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"is_foreign_key" boolean DEFAULT false NOT NULL,
	"classification" varchar(50),
	"alt_key_group" varchar(10),
	"default_value" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_model_canvas_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_model_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"layer" varchar(20) NOT NULL,
	"node_positions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"viewport" jsonb DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb NOT NULL,
	"notation" varchar(10) DEFAULT 'ie' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_model_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_model_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"business_name" varchar(255),
	"description" text,
	"entity_type" varchar(50) DEFAULT 'standard' NOT NULL,
	"layer" varchar(20) NOT NULL,
	"display_id" varchar(10),
	"alt_key_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_model_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_model_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"name" varchar(128),
	"name_inverse" varchar(128),
	"source_cardinality" varchar(20) NOT NULL,
	"target_cardinality" varchar(20) NOT NULL,
	"is_identifying" boolean DEFAULT false NOT NULL,
	"is_nullable_foreign_key" boolean DEFAULT false NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"waypoints" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_attribute" ADD CONSTRAINT "data_model_attribute_data_model_id_data_model_id_fk" FOREIGN KEY ("data_model_id") REFERENCES "public"."data_model"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_attribute" ADD CONSTRAINT "data_model_attribute_entity_id_data_model_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."data_model_entity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_attribute" ADD CONSTRAINT "data_model_attribute_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_canvas_state" ADD CONSTRAINT "data_model_canvas_state_data_model_id_data_model_id_fk" FOREIGN KEY ("data_model_id") REFERENCES "public"."data_model"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_canvas_state" ADD CONSTRAINT "data_model_canvas_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_entity" ADD CONSTRAINT "data_model_entity_data_model_id_data_model_id_fk" FOREIGN KEY ("data_model_id") REFERENCES "public"."data_model"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_entity" ADD CONSTRAINT "data_model_entity_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_relationship" ADD CONSTRAINT "data_model_relationship_data_model_id_data_model_id_fk" FOREIGN KEY ("data_model_id") REFERENCES "public"."data_model"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_relationship" ADD CONSTRAINT "data_model_relationship_source_entity_id_data_model_entity_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."data_model_entity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_relationship" ADD CONSTRAINT "data_model_relationship_target_entity_id_data_model_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."data_model_entity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_model_relationship" ADD CONSTRAINT "data_model_relationship_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_model_attribute_entity_name_idx" ON "data_model_attribute" USING btree ("entity_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_attribute_entity_id_idx" ON "data_model_attribute" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_attribute_data_model_id_idx" ON "data_model_attribute" USING btree ("data_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_model_canvas_state_model_user_layer_idx" ON "data_model_canvas_state" USING btree ("data_model_id","user_id","layer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_canvas_state_data_model_id_idx" ON "data_model_canvas_state" USING btree ("data_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_model_entity_model_name_idx" ON "data_model_entity" USING btree ("data_model_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_model_entity_model_display_id_idx" ON "data_model_entity" USING btree ("data_model_id","display_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_entity_data_model_id_idx" ON "data_model_entity" USING btree ("data_model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_relationship_data_model_id_idx" ON "data_model_relationship" USING btree ("data_model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_relationship_source_entity_id_idx" ON "data_model_relationship" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_model_relationship_target_entity_id_idx" ON "data_model_relationship" USING btree ("target_entity_id");