import { z } from "zod";

// Client-safe types + schema for the blog library used by the booking
// confirmation email's "recommended reading" section.
//
// One row in site_setting keyed 'blog_library'. JSONB value matches
// BlogLibrarySchema — an array of {title, url, summary} triples that
// matchBlogPosts() ranks against the prospect's stated reason.
//
// Mirrored pattern from booking-prompts-shared.ts.

export const BlogLibraryEntrySchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200),
  url: z.string().url("Must be a valid URL").max(500),
  summary: z.string().trim().min(1, "Summary required").max(500),
});

export const BlogLibrarySchema = z.array(BlogLibraryEntrySchema).max(100);

export type BlogLibraryEntry = z.infer<typeof BlogLibraryEntrySchema>;
export type BlogLibrary = z.infer<typeof BlogLibrarySchema>;

export const SITE_SETTING_KEY = "blog_library";

export const BLOG_LIBRARY_STARTER: BlogLibrary = [];
