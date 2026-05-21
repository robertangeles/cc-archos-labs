// /blog index — The Translation Layer landing. Paginated, listed-only,
// category-filterable via chip row. Feature-flagged: returns notFound()
// when `blog_enabled` site_setting is false (default).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isBlogEnabled } from "../../lib/blog/feature-flag";
import { buildPageMetadata } from "../../lib/site-config";
import {
  listAllCategories,
  listPosts,
} from "../../lib/posts";
import { CategoryChips } from "../../components/blog/category-chips";
import { EditorialListRow } from "../../components/blog/editorial-list-row";
import { Pagination } from "../../components/blog/pagination";

export const dynamic = "force-dynamic";
// ISR caching would help, but the feature flag check + admin save flow
// make dynamic the safer default for now. Phase D adds ISR + on-demand
// revalidate from admin save.

interface SearchParams {
  page?: string;
}

// generateMetadata reads searchParams so paginated /blog?page=N URLs get
// a self-canonical (otherwise both /blog and /blog?page=N declared
// canonical=/blog, which contradicts the paginated URLs being submitted
// to the sitemap).
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const pageNum = parsePage(params.page);
  const path = pageNum > 1 ? `/blog?page=${pageNum}` : "/blog";
  return buildPageMetadata({
    title: "The Translation Layer",
    description:
      "Essays on AI program risk, data architecture, and what actually breaks in transformation. By Rob Angeles, Archos Labs.",
    path,
    ogType: "website",
  });
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const enabled = await isBlogEnabled();
  if (!enabled) notFound();

  const params = await searchParams;
  const page = parsePage(params.page);
  const [{ posts, totalPages }, categories] = await Promise.all([
    listPosts({ page }),
    listAllCategories(),
  ]);

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto w-full max-w-[1080px] px-6 pt-24 pb-32 md:px-12">
        <header className="flex flex-col gap-y-6">
          <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
            The Translation Layer
          </p>
          <h1 className="text-display-md text-ink md:text-display-lg">
            Where AI programs break.
          </h1>
          <p className="max-w-[640px] text-body-lg leading-[1.6] text-ink-subtle">
            The Translation Layer is the only AI newsletter written by
            someone who has broken these programs from the inside and is
            building the replacements.
          </p>
        </header>

        <div className="mt-12 border-t border-hairline pt-8">
          <CategoryChips categories={categories} activeSlug={null} />
        </div>

        {posts.length === 0 ? (
          <p className="mt-16 text-body text-ink-subtle">
            No essays yet — the first ones are landing soon.
          </p>
        ) : (
          <ul className="mt-8 border-t border-hairline">
            {posts.map((p) => (
              <EditorialListRow key={p.id} post={p} />
            ))}
          </ul>
        )}

        <Pagination basePath="/blog" page={page} totalPages={totalPages} />
      </div>
    </main>
  );
}

function parsePage(input: string | undefined): number {
  if (!input) return 1;
  const n = Number(input);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
