// Admin posts list view. Server-renders the table from
// listPostsForAdmin(query) with searchParams-driven filters so deep links
// + browser refresh keep the filter state.
//
// Query string shape:
//   ?status=all|draft|scheduled|published|needs_review|archived
//   ?search=<title-or-slug substring>
//   ?categoryId=<uuid>
//   ?page=<n>&pageSize=<25 default, 100 max>

import Link from "next/link";
import { listPostsForAdmin } from "../../../../../lib/posts-admin";
import { PostListQuerySchema } from "../../../../../lib/posts-admin/schema";
import { PostsList } from "./posts-list";

export const dynamic = "force-dynamic";

interface PostsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminBlogPosts({ searchParams }: PostsPageProps) {
  const sp = await searchParams;

  // Coerce + validate via the same Zod schema the API route uses, so
  // garbage in the URL falls back to defaults rather than crashing the
  // page.
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") raw[k] = v;
    else if (Array.isArray(v) && v[0]) raw[k] = v[0];
  }
  const parsed = PostListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : PostListQuerySchema.parse({});

  const result = await listPostsForAdmin(query);

  return (
    <section>
      <div className="mb-8 flex items-center justify-between gap-x-4">
        <div>
          <h1 className="text-display-md text-ink">Posts</h1>
          <p className="mt-2 text-sm text-ink-subtle">
            The Translation Layer — drafts, scheduled, published, and the
            120-post needs-review queue from the migration.
          </p>
        </div>
        <Link
          href="/admin/blog/posts/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90 transition-opacity"
        >
          + New post
        </Link>
      </div>

      <PostsList
        initial={result.posts}
        totalCount={result.totalCount}
        page={result.page}
        totalPages={result.totalPages}
        currentStatus={query.status}
        currentSearch={query.search ?? ""}
      />
    </section>
  );
}
