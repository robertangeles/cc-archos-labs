import Image from "next/image";
import Link from "next/link";
import { truncateExcerpt } from "../../lib/post-rendering";
import type { HydratedRecommendedReading } from "../../lib/diagnostic/recommend";

// Recommended Readings block — rendered between the Action Plan and
// the "Next step" CTA on the diagnostic report. Evidence the exec
// forwards alongside the report to a budget approver.
//
// Design philosophy (revised 2026-05-24 after the first real-content
// render): the audience is an impatient CFO scanning 3 cards in
// seconds. Every block on the card must EARN its space against the
// question "would the CFO miss this if it weren't here?"
//
// Per-card hierarchy: image → category eyebrow (single short line) →
// title → gloss → reading time. Three meaningful pieces of content;
// the gloss is the lead. The gloss is the ONLY thing on this page
// written for THIS exec, for THIS report — everything else either
// repeats what they just read above (action titles) or is content
// marketing from a different context (blog-index excerpts).
//
// Removed in the simplification pass:
//   - "Supports: <action title>" attribution: action titles are
//     full sentences; stamped on every card they wallpaper the UI
//     in uppercase text the exec has to wade through before reaching
//     anything tailored. The exec just read the action plan one
//     section above — they don't need a verbose cross-reference.
//   - Generic blog-index excerpt: duplicates the gloss conceptually
//     in untargeted language. Falls back to a truncated excerpt only
//     when the gloss LLM degraded — otherwise hidden.
//   - Italic + hairline-divider gloss styling: visually competed
//     with the excerpt for attention. Now the gloss IS the subtitle,
//     body weight, no decoration.
//
// Server component. No-render when items is empty (D8 quiet-fail).
//
// Links are direct /blog/[slug] hrefs on this surface (web report
// view). Click tracking (PR3) will wrap them with /api/r/[postId]
// in a follow-up — but the PDF surface must stay on direct links
// regardless to avoid tracking-link aesthetics in the printed
// artefact (eng review E5 + D9 + spec review #5).

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
  // (or the retrieval/gloss step degraded, or every post in the rec
  // list has since been unpublished), render nothing.
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
                {/* Per-card information hierarchy (aggressive simplification
                 *  on 2026-05-24): the exec is impatient. Three meaningful
                 *  pieces per card, no wallpaper:
                 *    1. Category eyebrow (single short line; framing)
                 *    2. Title
                 *    3. Gloss — the ONLY content written for this exec,
                 *       for this report. Body weight (not italic), no
                 *       divider, so it reads as the natural subtitle.
                 *  Removed: per-card "Supports: <action title>" attribution
                 *  (wallpaper effect with sentence-length action titles);
                 *  generic blog-index excerpt (duplicates the gloss
                 *  conceptually but in untargeted language).
                 *  Footer: reading time only.
                 */}
                {item.categoryName ? (
                  <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
                    {item.categoryName}
                  </p>
                ) : null}
                <h3 className="mt-3 text-card-title text-ink visited:text-ink-muted">
                  {item.title}
                </h3>
                {item.gloss ? (
                  <p className="mt-3 text-body text-ink-subtle">
                    {item.gloss}
                  </p>
                ) : (
                  // Gloss failed soft (Claude error, hallucinated id).
                  // Fall back to a truncated excerpt so the card still
                  // has substance under the title.
                  item.excerpt ? (
                    <p className="mt-3 text-body-sm text-ink-subtle">
                      {truncateExcerpt(item.excerpt, 160)}
                    </p>
                  ) : null
                )}
                <p className="mt-5 text-caption text-ink-tertiary">
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
