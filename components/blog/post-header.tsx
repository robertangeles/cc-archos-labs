import Link from "next/link";
import { formatPublishedDate } from "../../lib/post-rendering";

// Post header — eyebrow (category link) + title + micro-row (byline +
// reading time + published date). Renders above the article body.
// Magazine-intentional: left-aligned, no centered text, no banner image
// (the OG image is a share artefact, not a hero).
//
// `lastReviewedAt` is still accepted on the props for API stability +
// future use (e.g. tooltip "Last reviewed: …" on hover of the date),
// but the visible micro-row says "Published <date>" to match the
// /blog index listing's labeling.

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
  lastReviewedAt: _lastReviewedAt,
}: PostHeaderProps) {
  const publishedDate = formatPublishedDate(publishedAt);
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
          Published{" "}
          <time dateTime={publishedAt.toISOString()}>{publishedDate}</time>
        </span>
      </div>
    </header>
  );
}
