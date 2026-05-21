import Image from "next/image";
import Link from "next/link";
import { formatLastReviewed, truncateExcerpt } from "../../lib/post-rendering";
import type { PublishedPostListItem } from "../../lib/posts";

// /blog index row pattern. Editorial-list (NOT cards) — hairline-separated
// rows. Title + eyebrow + excerpt + meta on the left; featured-image
// thumbnail on the right (banner-aspect 2.9:1 to match the dominant
// source-image shape from robertangeles.com).
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
        className="grid grid-cols-1 gap-x-6 gap-y-4 py-8 transition-colors duration-150 hover:bg-surface-1/40 md:grid-cols-[1fr_240px] md:items-start"
      >
        <div className="min-w-0">
          {post.categoryName && post.categorySlug ? (
            <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
              {post.categoryName}
            </p>
          ) : null}
          <h2 className="mt-2 text-headline text-ink visited:text-ink-muted">
            {post.title}
          </h2>
          {post.excerpt ? (
            <p className="mt-3 max-w-[640px] text-body-sm text-ink-subtle">
              {truncateExcerpt(post.excerpt, 160)}
            </p>
          ) : null}
          <p className="mt-4 text-caption text-ink-tertiary">
            {post.readingTimeMin} min read · Updated{" "}
            <time
              dateTime={(post.lastReviewedAt ?? post.publishedAt).toISOString()}
            >
              {lastReviewed}
            </time>
          </p>
        </div>

        {post.ogImagePath && !post.ogImageDeletedAt ? (
          <div className="relative aspect-[29/10] w-full overflow-hidden rounded border border-hairline bg-surface-1 md:order-last md:w-[240px]">
            <Image
              src={post.ogImagePath}
              // Alt text comes from post.og_image_alt (populated by
              // backfill / upload). Falls back to post title when null
              // (legacy migrated rows that lacked a WP alt).
              alt={post.ogImageAlt ?? post.title}
              fill
              sizes="(min-width: 768px) 240px, 100vw"
              className="object-cover"
            />
          </div>
        ) : null}
      </Link>
    </li>
  );
}
