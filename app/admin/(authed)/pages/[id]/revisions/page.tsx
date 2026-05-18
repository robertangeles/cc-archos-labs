// Admin: revision history for a single page. Each row shows when +
// who saved, the diff_size_pct (material change indicator), and a
// preview button. Restoring a revision creates a NEW revision row
// documenting the restore (audit trail preserved).

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminPageById,
  listRevisions,
} from "../../../../../../lib/pages";
import { RevisionsClient } from "./revisions-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminPagesRevisions({ params }: PageProps) {
  const { id } = await params;
  const page = await getAdminPageById(id);
  if (!page) notFound();

  const revisions = await listRevisions(id);

  return (
    <section>
      <div className="mb-8">
        <Link
          href={`/admin/pages/${id}`}
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← Back to edit
        </Link>
        <h1 className="mt-2 text-display-md text-ink">
          Revisions: {page.title}
        </h1>
        <p className="mt-2 text-sm text-ink-subtle">
          {revisions.length} revision{revisions.length === 1 ? "" : "s"} —
          newest first. Restore creates a new revision so the audit trail
          stays intact.
        </p>
      </div>

      <RevisionsClient pageId={id} initial={revisions} />
    </section>
  );
}
