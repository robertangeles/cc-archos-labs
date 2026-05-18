// Admin pages list view. Lists every page (published + draft + archived
// when toggled) with quick links to edit, view revisions, and archive.

import Link from "next/link";
import { PagesList } from "./pages-list";
import { listPagesForAdmin } from "../../../../lib/pages";

export const dynamic = "force-dynamic";

export default async function AdminPagesIndex() {
  const pages = await listPagesForAdmin({ includeArchived: true });

  return (
    <section>
      <div className="mb-8 flex items-center justify-between gap-x-4">
        <div>
          <h1 className="text-display-md text-ink">Pages</h1>
          <p className="mt-2 text-sm text-ink-subtle">
            DB-backed pages served via the catch-all route. Privacy + Terms
            were seeded automatically; future marketing pages live here too.
          </p>
        </div>
        <Link
          href="/admin/pages/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90 transition-opacity"
        >
          + New page
        </Link>
      </div>

      <PagesList initial={pages} />
    </section>
  );
}
