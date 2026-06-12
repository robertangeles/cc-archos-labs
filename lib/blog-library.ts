import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { siteSetting } from "./db/schema";
import {
  BLOG_LIBRARY_STARTER,
  BlogLibrarySchema,
  SITE_SETTING_KEY,
  type BlogLibrary,
} from "./blog-library-shared";

// Server-only loader for the blog library — an array of {title, url,
// summary} triples fed to matchBlogPosts() during booking creation.
//
// Soft-fallback semantics (matches booking-prompts.ts):
//   - DB row missing → empty array (no recommendations, not an outage)
//   - DB row malformed → log + empty array
//   - DB unreachable → log + empty array

export const getBlogLibrary = cache(async (): Promise<BlogLibrary> => {
  let rows;
  try {
    const db = getDb();
    rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);
  } catch (err) {
    console.warn(
      "[blog-library] DB unreachable, falling back to empty library:",
      err,
    );
    return BLOG_LIBRARY_STARTER;
  }

  if (rows.length === 0) {
    return BLOG_LIBRARY_STARTER;
  }

  const parsed = BlogLibrarySchema.safeParse(rows[0].value);
  if (!parsed.success) {
    console.warn(
      `[blog-library] Stored row failed validation. Falling back to empty library. ` +
        `Re-save the library in /admin/prompts.`,
    );
    return BLOG_LIBRARY_STARTER;
  }

  return parsed.data;
});
