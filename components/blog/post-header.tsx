import Link from "next/link";
import { formatLastReviewed } from "../../lib/post-rendering";

// Post header — eyebrow (category link) + title + micro-row (byline +
// reading time + last reviewed). Renders above the article body.
// Magazine-intentional: left-aligned, no centered text, no banner image
// (the OG image is a share artefact, not a hero).

export interface PostHeaderProps {
  title: string;
  authorName: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  readingTimeMin: number;
  publishedAt: Date;
  lastReviewedAt: Date | null;
}

export function PostHeader({
  title,
  authorName,
  categorySlug,
  categoryName,
  readingTimeMin,
  publishedAt,
  lastReviewedAt,
}: PostHeaderProps) {
  const lastReviewed = formatLastReviewed(lastReviewedAt, publishedAt);
  return (
    <header className="flex flex-col gap-y-6">
      {categoryName && categorySlug ? (
        <Link
          href={`/blog/category/${categorySlug}`}
          className="text-eyebrow uppercase tracking-[0.08em] text-primary hover:text-primary-hover"
        >
          {categoryName}
        </Link>
      ) : (
        <span className="text-eyebrow uppercase tracking-[0.08em] text-primary">
          The Translation Layer
        </span>
      )}

      <h1 className="text-display-md text-ink md:text-display-lg">{title}</h1>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-subtle">
        {authorName ? <span>{authorName}</span> : null}
        {authorName ? <span aria-hidden>·</span> : null}
        <span>{readingTimeMin} min read</span>
        <span aria-hidden>·</span>
        <span>
          Last reviewed{" "}
          <time dateTime={(lastReviewedAt ?? publishedAt).toISOString()}>
            {lastReviewed}
          </time>
        </span>
      </div>
    </header>
  );
}
