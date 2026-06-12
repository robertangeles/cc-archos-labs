CREATE TABLE "publish_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"content_preview" varchar(500) NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"published_url" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"provider_subject" text NOT NULL,
	"account_identifier" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"is_connected" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_account_user_platform_uniq" UNIQUE("user_id","platform")
);
--> statement-breakpoint
ALTER TABLE "publish_log" ADD CONSTRAINT "publish_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_log" ADD CONSTRAINT "publish_log_social_account_id_social_account_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_log_user_id_idx" ON "publish_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "publish_log_social_account_id_idx" ON "publish_log" USING btree ("social_account_id");--> statement-breakpoint
CREATE INDEX "publish_log_created_at_idx" ON "publish_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "publish_log_content_hash_platform_idx" ON "publish_log" USING btree ("content_hash","platform");--> statement-breakpoint
CREATE INDEX "social_account_user_id_idx" ON "social_account" USING btree ("user_id");