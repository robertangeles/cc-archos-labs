import Link from "next/link";
import type { ReadNextItem } from "../../lib/posts";

// Read-next widget — 3-card grid at the bottom of every /blog/[slug] page.
// AI-slop-resistant per DES-1 of the plan:
//   - NO icons in coloured circles
//   - NO centered text
//   - NO drop shadows or glow
//   - NO bold border-left accent stripe
//   - NO "Read more →" pseudo-CTA
//   - Eyebrow + title + one-line excerpt only
//   - Whole card clickable; title underlines on hover
//   - bg-surface-1 → bg-surface-2 on hover (token-system hover ladder)
//   - Single-column stack on mobile (NOT awkward 2-up)
//
// Server component. Falls back to no-render if fewer than 1 candidate.

export interface ReadNextProps {
  items: ReadNextItem[];
}

export function ReadNext({ items }: ReadNextProps) {
  if (items.length === 0) {
    return (
      <section aria-labelledby="read-next-heading" className="mt-20">
        <h2
          id="read-next-heading"
          className="text-eyebrow uppercase tracking-[0.08em] text-primary"
        >
          Read next
        </h2>
        <div className="mt-4 border-t border-hairline pt-6">
          <Link
            href="/blog"
            className="text-body text-ink hover:text-primary"
          >
            Browse all essays →
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="read-next-heading" className="mt-20">
      <h2
        id="read-next-heading"
        className="text-eyebrow uppercase tracking-[0.08em] text-primary"
      >
        Read next
      </h2>
      <div className="mt-4 border-t border-hairline pt-6">
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/blog/${item.slug}`}
                className="block h-full rounded-lg border border-hairline bg-surface-1 p-6 transition-colors duration-150 hover:bg-surface-2"
              >
                {item.categoryName ? (
                  <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
                    {item.categoryName}
                  </p>
                ) : null}
                <h3 className="mt-3 text-card-title text-ink visited:text-ink-muted">
                  {item.title}
                </h3>
                {item.excerpt ? (
                  <p className="mt-3 line-clamp-2 text-body-sm text-ink-subtle">
                    {item.excerpt}
                  </p>
                ) : null}
                <p className="mt-4 text-caption text-ink-tertiary">
                  {item.readingTimeMin} min read
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
