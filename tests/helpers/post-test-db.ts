import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// Ephemeral-Postgres harness for the scheduled publisher, against a REAL
// Postgres engine (pglite, in-process, no Docker).
//
// Why stubs instead of replaying drizzle/0013 + 0014: migration 0013 does
// `CREATE EXTENSION vector` and declares `embedding vector(1024)`, and pgvector
// is not loaded in this pglite build. The publisher never touches the embedding
// column, so replaying that migration would drag an extension into the test for
// nothing. tests/helpers/org-test-db.ts already established this pattern with
// USERS_STUB ("we only need the columns the tables reference").
//
// Columns below are exactly what publishScheduledPosts selects, filters on, or
// writes — plus is_agent_generated, the column under test. If the publisher
// starts reading a new column, this stub must grow with it, and the test will
// fail loudly rather than silently skip coverage.
//
// Caveat inherited from pglite: single-connection, so this does NOT exercise
// FOR UPDATE SKIP LOCKED concurrency. It validates the WHERE predicate, which
// is precisely what migration 0036 changes.

const POST_STUB = `
  CREATE TABLE IF NOT EXISTS "post" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL UNIQUE,
    "title" text NOT NULL,
    "excerpt" text,
    "content_md" text NOT NULL DEFAULT '',
    "seo_title" text,
    "seo_description" text,
    "status" text NOT NULL DEFAULT 'draft',
    "visibility" text NOT NULL DEFAULT 'listed',
    "needs_review" boolean NOT NULL DEFAULT false,
    "is_agent_generated" boolean NOT NULL DEFAULT false,
    -- Everything below exists because updatePost ends in .returning(), which
    -- drizzle expands to EVERY column declared on the post table. A stub
    -- missing any one of them fails with a bare "column ... does not exist"
    -- from inside the transaction. FKs are dropped on purpose: this harness
    -- has no author/category/users tables and the write path never joins them.
    "author_id" uuid,
    "category_id" uuid,
    "source_wp_id" integer,
    "last_reviewed_at" timestamp with time zone,
    -- Real column is vector(1024). pgvector is not loaded in this pglite
    -- build, and nothing on the write path reads or writes it, so a nullable
    -- text placeholder is enough to satisfy .returning().
    "embedding" text,
    "og_image_path" text,
    "og_image_generated_at" timestamp with time zone,
    "og_image_alt" text,
    "og_image_width" integer,
    "og_image_height" integer,
    "og_image_filename" text,
    "og_image_mime_type" text,
    "og_image_size_kb" integer,
    "og_image_uploaded_by" uuid,
    "og_image_uploaded_at" timestamp with time zone,
    "og_image_checksum" text,
    "og_image_r2_key" text,
    "og_image_deleted_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "scheduled_publish_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    "word_count" integer NOT NULL DEFAULT 0,
    "reading_time_min" integer NOT NULL DEFAULT 0,
    "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
  )
`;

// updatePost re-reads the saved row through getAdminPostById, which LEFT JOINs
// both lookup tables for the display name/slug. Only the columns that join
// selects are declared; nothing on the write path inserts into them.
const AUTHOR_STUB = `
  CREATE TABLE IF NOT EXISTS "author" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "slug" text NOT NULL UNIQUE
  )
`;

const CATEGORY_STUB = `
  CREATE TABLE IF NOT EXISTS "category" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "slug" text NOT NULL UNIQUE
  )
`;

const POST_REVISION_STUB = `
  CREATE TABLE IF NOT EXISTS "post_revision" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "post_id" uuid NOT NULL REFERENCES "post"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "content_md" text NOT NULL,
    "excerpt" text,
    "seo_title" text,
    "seo_description" text,
    "diff_size_pct" numeric(5,2) NOT NULL DEFAULT '0',
    "saved_by" text NOT NULL DEFAULT 'admin',
    "saved_at" timestamp with time zone NOT NULL DEFAULT now()
  )
`;

// Mirrors drizzle/0014_post_scheduled_publish_at.sql:34 so the test exercises
// the same partial index production uses.
const DUE_INDEX = `
  CREATE INDEX IF NOT EXISTS "post_due_for_publish_idx"
    ON "post" USING btree ("scheduled_publish_at") WHERE status = 'scheduled'
`;

export interface PostTestDb {
  db: DB;
  client: PGlite;
  /** Insert a post, returning its id. Defaults make a due-now scheduled post. */
  createPost: (over?: {
    slug?: string;
    status?: string;
    scheduledPublishAt?: Date | null;
    needsReview?: boolean;
    isAgentGenerated?: boolean;
    lastReviewedAt?: Date | null;
  }) => Promise<string>;
  close: () => Promise<void>;
}

export async function makePostTestDb(): Promise<PostTestDb> {
  const client = new PGlite();
  await client.query(AUTHOR_STUB);
  await client.query(CATEGORY_STUB);
  await client.query(POST_STUB);
  await client.query(POST_REVISION_STUB);
  await client.query(DUE_INDEX);

  const db = drizzle(client, { schema }) as unknown as DB;
  let n = 0;

  return {
    db,
    client,
    createPost: async (over = {}) => {
      n += 1;
      const res = await client.query<{ id: string }>(
        `INSERT INTO "post"
           ("slug","title","content_md","status","scheduled_publish_at",
            "needs_review","is_agent_generated","last_reviewed_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          over.slug ?? `post-${n}`,
          `Post ${n}`,
          "Body.",
          over.status ?? "scheduled",
          over.scheduledPublishAt === undefined
            ? new Date(Date.now() - 60_000)
            : over.scheduledPublishAt,
          over.needsReview ?? false,
          over.isAgentGenerated ?? false,
          over.lastReviewedAt ?? null,
        ],
      );
      return res.rows[0].id;
    },
    close: async () => {
      await client.close();
    },
  };
}
