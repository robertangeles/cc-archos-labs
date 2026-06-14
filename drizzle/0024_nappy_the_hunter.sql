CREATE TABLE "scheduled_social_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"content" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"display_timezone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_url" text,
	"published_at" timestamp with time zone,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_social_post" ADD CONSTRAINT "scheduled_social_post_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_social_post_status_scheduled_for_idx" ON "scheduled_social_post" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_social_post_user_id_idx" ON "scheduled_social_post" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_social_post_user_status_idx" ON "scheduled_social_post" USING btree ("user_id","status");