// Admin: edit an existing post. Loads the post + author + category
// lookups server-side so the form opens with everything it needs
// (no client-side spinner waiting on dropdown data).

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminPostById,
  listAuthorsForAdmin,
  listCategoriesForAdmin,
} from "../../../../../../lib/posts-admin";
import { PostForm } from "../post-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminBlogPostsEdit({ params }: PageProps) {
  const { id } = await params;
  const [post, authors, categories] = await Promise.all([
    getAdminPostById(id),
    listAuthorsForAdmin(),
    listCategoriesForAdmin(),
  ]);
  if (!post) notFound();

  return (
    <section>
      <div className="mb-8">
        <Link
          href="/admin/blog/posts"
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← All posts
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-x-4">
          <h1 className="min-w-0 break-words text-display-md text-ink">
            {post.title}
          </h1>
          <div className="flex shrink-0 items-center gap-x-4 text-xs">
            {post.status === "published" ? (
              <Link
                href={`/blog/${post.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View live →
              </Link>
            ) : null}
            <Link
              href={`/admin/blog/posts/${post.id}/revisions`}
              className="text-primary hover:underline"
            >
              Revisions
            </Link>
          </div>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-subtle">/blog/{post.slug}</p>
      </div>

      <PostForm initial={post} authors={authors} categories={categories} />
    </section>
  );
}
