// Admin: create a new post. Wraps PostForm with no initial state and
// pre-loads the author + category lists so the dropdowns can render
// without a client-side fetch round-trip.

import Link from "next/link";
import {
  listAuthorsForAdmin,
  listCategoriesForAdmin,
} from "../../../../../../lib/posts-admin";
import { PostForm } from "../post-form";

export const dynamic = "force-dynamic";

export default async function AdminBlogPostsNew() {
  const [authors, categories] = await Promise.all([
    listAuthorsForAdmin(),
    listCategoriesForAdmin(),
  ]);

  return (
    <section>
      <div className="mb-8">
        <Link
          href="/admin/blog/posts"
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← All posts
        </Link>
        <h1 className="mt-2 text-display-md text-ink">New post</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          Saves as a draft by default. Slug becomes the public URL once
          published. Switch status to &quot;Scheduled&quot; to pick an
          auto-publish time.
        </p>
      </div>

      <PostForm authors={authors} categories={categories} />
    </section>
  );
}
