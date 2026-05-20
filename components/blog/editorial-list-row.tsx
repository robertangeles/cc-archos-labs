import Link from "next/link";
import { formatLastReviewed } from "../../lib/post-rendering";
import type { PublishedPostListItem } from "../../lib/posts";

// /blog index row pattern. Editorial-list (NOT cards) — hairline-separated
// rows, eyebrow + title + one-line excerpt + meta line. Whole row clickable.
//
// Cards are reserved for the read-next widget (DES-1). Index uses the
// list pattern for higher density — readers scan dozens of titles, not
// three.

export interface EditorialListRowProps {
  post: PublishedPostListItem;
}

export function EditorialListRow({ post }: EditorialListRowProps) {
  const lastReviewed = formatLastReviewed(post.lastReviewedAt, post.publishedAt);
  return (
    <li className="border-b border-hairline">
      <Link
        href={`/blog/${post.slug}`}
        className="block py-8 transition-colors duration-150 hover:bg-surface-1/40"
      >
        {post.categoryName && post.categorySlug ? (
          <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
            {post.categoryName}
          </p>
        ) : null}
        <h2 className="mt-2 text-headline text-ink visited:text-ink-muted">
          {post.title}
        </h2>
        {post.excerpt ? (
          <p className="mt-3 line-clamp-2 max-w-[640px] text-body-sm text-ink-subtle">
            {post.excerpt}
          </p>
        ) : null}
        <p className="mt-4 text-caption text-ink-tertiary">
          {post.readingTimeMin} min read · Updated{" "}
          <time dateTime={(post.lastReviewedAt ?? post.publishedAt).toISOString()}>
            {lastReviewed}
          </time>
        </p>
      </Link>
    </li>
  );
}
