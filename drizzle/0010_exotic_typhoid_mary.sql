CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"excerpt" text,
	"seo_title" text,
	"seo_description" text,
	"template" text DEFAULT 'long_form' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"og_type" text DEFAULT 'article' NOT NULL,
	"published_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "page_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"diff_size_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"saved_by" text DEFAULT 'admin' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_revision" ADD CONSTRAINT "page_revision_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_status_published_at_idx" ON "page" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "page_archived_at_idx" ON "page" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "page_revision_page_id_saved_at_idx" ON "page_revision" USING btree ("page_id","saved_at");