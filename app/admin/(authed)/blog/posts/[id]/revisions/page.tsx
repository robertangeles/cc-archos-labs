// Admin: revision history for a single post. Each row shows when + who
// saved, the diff_size_pct (material change indicator), and a preview
// toggle. Restoring a revision creates a NEW revision row documenting
// the restore (audit trail preserved). Mirrors the Pages CMS pattern.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminPostById,
  listRevisionsForPost,
} from "../../../../../../../lib/posts-admin";
import { RevisionsClient } from "./revisions-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminBlogPostsRevisions({ params }: PageProps) {
  const { id } = await params;
  const post = await getAdminPostById(id);
  if (!post) notFound();

  const revisions = await listRevisionsForPost(id);

  return (
    <section>
      <div className="mb-8">
        <Link
          href={`/admin/blog/posts/${id}`}
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← Back to edit
        </Link>
        <h1 className="mt-2 text-display-md text-ink">
          Revisions: {post.title}
        </h1>
        <p className="mt-2 text-sm text-ink-subtle">
          {revisions.length} revision{revisions.length === 1 ? "" : "s"} —
          newest first. Restoring creates a new revision so the audit
          trail stays intact.
        </p>
      </div>

      <RevisionsClient postId={id} initial={revisions} />
    </section>
  );
}
