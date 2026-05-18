// Admin: edit an existing page. Wraps PageForm with the loaded row.
// Shows the public URL + a link to the revisions view.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminPageById,
  listBlocksForPage,
} from "../../../../../lib/pages";
import { PageForm } from "../page-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminPagesEdit({ params }: PageProps) {
  const { id } = await params;
  const page = await getAdminPageById(id);
  if (!page) notFound();

  // Preload blocks server-side for composed pages so the BlocksEditor
  // has its initial state without a client-side fetch round-trip.
  // Long-form pages get an empty array (no blocks rows) — cheap query.
  const blocks =
    page.template === "composed" ? await listBlocksForPage(id) : [];

  return (
    <section>
      <div className="mb-8">
        <Link
          href="/admin/pages"
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← All pages
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-x-4">
          <h1 className="text-display-md text-ink">{page.title}</h1>
          <div className="flex items-center gap-x-4 text-xs">
            <Link
              href={`/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View live →
            </Link>
            <Link
              href={`/admin/pages/${page.id}/revisions`}
              className="text-primary hover:underline"
            >
              Revisions
            </Link>
          </div>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-subtle">/{page.slug}</p>
      </div>

      <PageForm initial={page} initialBlocks={blocks} />
    </section>
  );
}
