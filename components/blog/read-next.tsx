import Image from "next/image";
import Link from "next/link";
import { truncateExcerpt } from "../../lib/post-rendering";
import type { ReadNextItem } from "../../lib/posts";

// Read-next widget — 3-card grid at the bottom of every /blog/[slug] page.
// AI-slop-resistant variant of the standard 3-card content widget:
//   - No icons in coloured circles
//   - No centered text
//   - No drop shadows or glow
//   - No bold border-left accent stripe
//   - No "Read more →" pseudo-CTA
//   - Eyebrow + title + one-line excerpt + reading time only
//   - Featured-image thumbnail at the top of each card (banner aspect,
//     matches the source-image dimensions from robertangeles.com)
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
                className="group block h-full overflow-hidden rounded-lg border border-hairline bg-surface-1 transition-colors duration-150 hover:bg-surface-2"
              >
                {item.ogImagePath ? (
                  <div
                    className="relative aspect-[29/10] w-full overflow-hidden bg-surface-2"
                    aria-hidden
                  >
                    <Image
                      src={item.ogImagePath}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : null}
                <div className="p-6">
                  {item.categoryName ? (
                    <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
                      {item.categoryName}
                    </p>
                  ) : null}
                  <h3 className="mt-3 text-card-title text-ink visited:text-ink-muted">
                    {item.title}
                  </h3>
                  {item.excerpt ? (
                    <p className="mt-3 text-body-sm text-ink-subtle">
                      {truncateExcerpt(item.excerpt, 160)}
                    </p>
                  ) : null}
                  <p className="mt-4 text-caption text-ink-tertiary">
                    {item.readingTimeMin} min read
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
