import Link from "next/link";

// Compact pagination for /blog index. Renders "← Newer / Page N of M / Older →"
// row. Honours the current page's category prefix.

export interface PaginationProps {
  basePath: string; // "/blog" or "/blog/category/data-as-a-decision-infrastructure"
  page: number;
  totalPages: number;
}

export function Pagination({ basePath, page, totalPages }: PaginationProps) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;
  const link = (p: number | null) =>
    p ? (p === 1 ? basePath : `${basePath}?page=${p}`) : null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-between border-t border-hairline pt-8"
    >
      <div>
        {prev !== null ? (
          <Link
            href={link(prev)!}
            rel="prev"
            className="text-body-sm text-ink hover:text-primary"
          >
            ← Newer
          </Link>
        ) : (
          <span className="text-body-sm text-ink-tertiary">← Newer</span>
        )}
      </div>
      <p className="text-caption text-ink-subtle">
        Page {page} of {totalPages}
      </p>
      <div>
        {next !== null ? (
          <Link
            href={link(next)!}
            rel="next"
            className="text-body-sm text-ink hover:text-primary"
          >
            Older →
          </Link>
        ) : (
          <span className="text-body-sm text-ink-tertiary">Older →</span>
        )}
      </div>
    </nav>
  );
}
