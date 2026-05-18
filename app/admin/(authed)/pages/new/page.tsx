// Admin: create a new page. Wraps PageForm with no initial state.

import Link from "next/link";
import { PageForm } from "../page-form";

export const dynamic = "force-dynamic";

export default function AdminPagesNew() {
  return (
    <section>
      <div className="mb-8">
        <Link
          href="/admin/pages"
          className="text-sm text-ink-subtle hover:text-ink"
        >
          ← All pages
        </Link>
        <h1 className="mt-2 text-display-md text-ink">New page</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          Saves as a draft by default. Slug becomes the public URL once
          published.
        </p>
      </div>

      <PageForm />
    </section>
  );
}
