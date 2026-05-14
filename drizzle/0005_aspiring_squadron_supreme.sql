CREATE TABLE "integration_secret_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_name" text NOT NULL,
	"operation" text NOT NULL,
	"actor" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "integration_secret_audit_key_name_idx" ON "integration_secret_audit" USING btree ("key_name");--> statement-breakpoint
CREATE INDEX "integration_secret_audit_created_at_idx" ON "integration_secret_audit" USING btree ("created_at");