import Image from "next/image";
import Link from "next/link";
import { truncateExcerpt } from "../../lib/post-rendering";
import type { HydratedRecommendedReading } from "../../lib/diagnostic/recommend";

// Recommended Readings block — rendered between the Action Plan and
// the "Next step" CTA on the diagnostic report. Sits in the IA after
// the case-making (verdict → narrative → actions) and before the ask
// (book a call), as evidence the exec can forward to a budget approver.
//
// Visual language mirrors components/blog/read-next.tsx so the brand
// reads as consistent — AI-slop-resistant card pattern:
//   - No icons in coloured circles, no centered text, no drop shadows,
//     no "Read more →" pseudo-CTAs
//   - Eyebrow + title + truncated excerpt + reading time
//   - Featured-image thumbnail in banner aspect
//   - Whole card clickable; bg hover ladder; underline on hover
//
// Differences from read-next.tsx:
//   - Per-card "Supports: <action title>" attribution tag above the
//     eyebrow when actionIndex >= 0 (D4 + D15 v1 visual)
//   - One-sentence italic gloss between excerpt and reading-time
//     line. Renders ONLY when gloss is non-empty (LLM degraded → no
//     gloss → no italic line, card still renders cleanly)
//   - Heading reads "Recommended reading" — singular tone matches
//     the curated, per-action framing
//
// Server component. No-render when items is empty (D8 quiet-fail).
//
// D9: links are direct /blog/[slug] hrefs on this surface (web report
// view). Click tracking (PR3) will wrap them with /api/r/[postId] in
// a follow-up — but the PDF surface (T9) must stay on direct links
// regardless to avoid tracking-link aesthetics in the printed
// artefact (eng review E5 + spec review #5).

export interface RecommendedReadingsProps {
  items: HydratedRecommendedReading[];
  /** When true, links to /blog/[slug] directly (no /api/r/ wrapper).
   *  Set true on the PDF route in T9. Default false. */
  printMode?: boolean;
}

export function RecommendedReadings({
  items,
  printMode = false,
}: RecommendedReadingsProps) {
  // Quiet fail per D8: if no posts cleared the similarity threshold
  // (or the feature flag was off when the report generated, or every
  // post in the rec list has since been unpublished), render nothing.
  if (items.length === 0) return null;

  // Suppress the "printMode" prop in a way that signals intent to
  // readers (the value will be load-bearing in PR3 click tracking).
  void printMode;

  return (
    <section
      aria-labelledby="recommended-readings-heading"
      className="mt-20 print:mt-16"
    >
      <p className="text-eyebrow uppercase tracking-[0.08em] text-primary">
        Supporting evidence
      </p>
      <h2
        id="recommended-readings-heading"
        className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-ink md:text-[32px] print:text-[24px]"
      >
        Recommended reading
      </h2>
      <p className="mt-4 max-w-[600px] text-base leading-[1.6] text-ink-subtle print:text-[13px]">
        Forward these alongside this report. Each post argues the case
        for a specific action above and gives the budget approver the
        reasoning they need.
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={`${item.postId}-${item.actionIndex}`}>
            <Link
              href={`/blog/${item.slug}`}
              className="group block h-full overflow-hidden rounded-lg border border-hairline bg-surface-1 transition-colors duration-150 hover:bg-surface-2 print:break-inside-avoid"
            >
              {item.ogImagePath && !item.ogImageDeletedAt ? (
                <div className="relative aspect-[29/10] w-full overflow-hidden bg-surface-2">
                  <Image
                    src={item.ogImagePath}
                    alt={item.ogImageAlt ?? item.title}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              ) : null}
              <div className="p-6">
                {item.actionTitle ? (
                  <p className="text-caption font-medium uppercase tracking-[0.06em] text-ink-tertiary">
                    Supports: {item.actionTitle}
                  </p>
                ) : null}
                {item.categoryName ? (
                  <p
                    className={`text-eyebrow uppercase tracking-[0.08em] text-ink-subtle ${
                      item.actionTitle ? "mt-2" : ""
                    }`}
                  >
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
                {item.gloss ? (
                  <p className="mt-4 border-t border-hairline pt-3 text-body-sm italic text-ink-subtle">
                    {item.gloss}
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
    </section>
  );
}
