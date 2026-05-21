// /blog/category/[slug] — posts filtered to a single category. Same
// shell as /blog index but with the category name as the H1 and the
// matching chip pre-selected. Feature-flagged.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isBlogEnabled } from "../../../../lib/blog/feature-flag";
import {
  getCategoryBySlug,
  listAllCategories,
  listPosts,
} from "../../../../lib/posts";
import { buildPageMetadata } from "../../../../lib/site-config";
import { CategoryChips } from "../../../../components/blog/category-chips";
import { EditorialListRow } from "../../../../components/blog/editorial-list-row";
import { Pagination } from "../../../../components/blog/pagination";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) {
    return buildPageMetadata({ title: "Category not found" });
  }
  // Paginated category URLs get a self-canonical so the sitemap can submit
  // /blog/category/x?page=N without contradicting the rendered HTML.
  const { page: pageParam } = await searchParams;
  const pageNum = parsePage(pageParam);
  const basePath = `/blog/category/${category.slug}`;
  const path = pageNum > 1 ? `${basePath}?page=${pageNum}` : basePath;
  return buildPageMetadata({
    title: category.name,
    description:
      category.description ??
      `Essays on ${category.name.toLowerCase()} from The Translation Layer.`,
    path,
    ogType: "website",
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const enabled = await isBlogEnabled();
  if (!enabled) notFound();

  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const [{ posts, totalPages }, categories] = await Promise.all([
    listPosts({ page, categorySlug: slug }),
    listAllCategories(),
  ]);

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto w-full max-w-[1080px] px-6 pt-24 pb-32 md:px-12">
        <header className="flex flex-col gap-y-6">
          <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
            {category.name}
          </p>
          <h1 className="text-display-md text-ink md:text-display-lg">
            {category.name}.
          </h1>
          {category.description ? (
            <p className="max-w-[640px] text-body-lg leading-[1.6] text-ink-subtle">
              {category.description}
            </p>
          ) : null}
        </header>

        <div className="mt-12 border-t border-hairline pt-8">
          <CategoryChips categories={categories} activeSlug={slug} />
        </div>

        {posts.length === 0 ? (
          <p className="mt-16 text-body text-ink-subtle">
            No posts in this category yet.
          </p>
        ) : (
          <ul className="mt-8 border-t border-hairline">
            {posts.map((p) => (
              <EditorialListRow key={p.id} post={p} />
            ))}
          </ul>
        )}

        <Pagination
          basePath={`/blog/category/${slug}`}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </main>
  );
}

function parsePage(input: string | undefined): number {
  if (!input) return 1;
  const n = Number(input);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
