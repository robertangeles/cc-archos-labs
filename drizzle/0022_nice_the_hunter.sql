CREATE TABLE "user_brain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"brain_client_id" text NOT NULL,
	"brain_client_secret_encrypted" text NOT NULL,
	"provisioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_brain_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "content_type" varchar(20) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_brain" ADD CONSTRAINT "user_brain_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_brain_user_id_idx" ON "user_brain" USING btree ("user_id");