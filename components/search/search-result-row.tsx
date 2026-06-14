"use client";

import Image from "next/image";
import Link from "next/link";
import { truncateExcerpt } from "../../lib/post-rendering";

export interface SearchResult {
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  readingTimeMin: number;
  ogImagePath: string | null;
  ogImageDeletedAt: Date | string | null;
  ogImageAlt: string | null;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  distance: number | null;
}

interface SearchResultRowProps {
  result: SearchResult;
  compact?: boolean;
  isActive?: boolean;
  onClick?: () => void;
}

export function SearchResultRow({
  result,
  compact = false,
  isActive = false,
  onClick,
}: SearchResultRowProps) {
  const hasImage =
    result.ogImagePath && !result.ogImageDeletedAt;

  if (compact) {
    return (
      <Link
        href={`/blog/${result.slug}`}
        onClick={onClick}
        className={`flex items-center gap-x-3 rounded px-3 py-2.5 transition-colors duration-100 ${
          isActive ? "bg-surface-1" : "hover:bg-surface-1/60"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {result.title}
          </p>
          <p className="mt-0.5 flex items-center gap-x-2 text-xs text-ink-subtle">
            {result.categoryName && (
              <span className="text-primary">{result.categoryName}</span>
            )}
            <span>{result.readingTimeMin} min read</span>
          </p>
        </div>
      </Link>
    );
  }

  return (
    <li className="border-b border-hairline">
      <Link
        href={`/blog/${result.slug}`}
        onClick={onClick}
        className="grid grid-cols-1 gap-x-6 gap-y-4 py-8 transition-colors duration-150 hover:bg-surface-1/40 md:grid-cols-[1fr_240px] md:items-start"
      >
        <div className="min-w-0">
          {result.categoryName && (
            <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
              {result.categoryName}
            </p>
          )}
          <h2 className="mt-2 text-headline text-ink">{result.title}</h2>
          {result.excerpt && (
            <p className="mt-3 max-w-[640px] text-body-sm text-ink-subtle">
              {truncateExcerpt(result.excerpt, 160)}
            </p>
          )}
          <p className="mt-4 text-caption text-ink-tertiary">
            {result.readingTimeMin} min read
          </p>
        </div>

        {hasImage && (
          <div className="relative aspect-[29/10] w-full overflow-hidden rounded border border-hairline bg-surface-1 md:order-last md:w-[240px]">
            <Image
              src={result.ogImagePath!}
              alt={result.ogImageAlt ?? result.title}
              fill
              sizes="(min-width: 768px) 240px, 100vw"
              className="object-cover"
            />
          </div>
        )}
      </Link>
    </li>
  );
}
