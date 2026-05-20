import Link from "next/link";
import type { CategoryView } from "../../lib/posts";

// Category filter row on /blog and /blog/category/[slug]. Pill chips —
// pricing-tab pattern from DESIGN.md. Active chip has bg-surface-2 +
// text-ink; inactive chips have transparent bg + text-ink-subtle.
// "All" chip resets to /blog.

export interface CategoryChipsProps {
  categories: CategoryView[];
  /** Slug of the currently-active category, or null for /blog (All). */
  activeSlug: string | null;
}

export function CategoryChips({ categories, activeSlug }: CategoryChipsProps) {
  return (
    <nav aria-label="Filter posts by category" className="flex flex-wrap gap-2">
      <CategoryChip href="/blog" label="All" isActive={activeSlug === null} />
      {categories.map((c) => (
        <CategoryChip
          key={c.slug}
          href={`/blog/category/${c.slug}`}
          label={c.name}
          isActive={activeSlug === c.slug}
        />
      ))}
    </nav>
  );
}

function CategoryChip({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`inline-flex items-center rounded-full border border-hairline px-3 py-1 text-button transition-colors duration-150 ${
        isActive
          ? "bg-surface-2 text-ink"
          : "bg-canvas text-ink-subtle hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
