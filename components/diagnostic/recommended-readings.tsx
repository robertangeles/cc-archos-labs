import Image from "next/image";
import Link from "next/link";
import { truncateExcerpt } from "../../lib/post-rendering";
import type { HydratedRecommendedReading } from "../../lib/diagnostic/recommend";

// Recommended Readings block — rendered between the Action Plan and
// the "Next step" CTA on the diagnostic report. Evidence the exec
// forwards alongside the report to a budget approver.
//
// Layout (revised 2026-05-24 via /frontend-design): horizontal
// stacked cards in a single column, NOT a 3-up grid. The whole
// report above this section is single-column editorial prose
// (verdict → narrative → action plan) — a 3-up grid right at the
// "evidence for each action" moment broke the case-file rhythm
// and made the section read like a content-marketing block.
//
// Each card: square image on the left (sm+), content right.
// Mobile (<sm) drops the image entirely — the gloss is the value;
// thumbnails compete for screen real estate on a 375px viewport.
//
// Per-card hierarchy: image (sm+) | category eyebrow → title →
// gloss → reading time. The gloss is the lead — the only content
// on the page written for THIS exec, for THIS report. Constrained
// to max-w-[60ch] so it reads as one prose sentence at natural
// line length, instead of fragmented across narrow grid columns.
//
// Earlier simplification pass dropped:
//   - "Supports: <action title>" attribution row (wallpaper effect
//     with sentence-length action titles)
//   - Generic blog-index excerpt (duplicates the gloss in
//     untargeted language; falls back only when gloss LLM degraded)
//   - Italic + hairline-divider gloss styling (competed visually
//     with excerpt; now the gloss IS the subtitle, body weight)
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
      // mt-20 separates the section from the action plan above on the
      // BROWSER view (single-page scroll). In print this section
      // starts on its own page (via the wrapping section's
      // print:break-before-page in report-view.tsx), so a top margin
      // becomes dead whitespace that pushes the eyebrow halfway down
      // page 4. print:mt-0 anchors the eyebrow to the section's own
      // top padding.
      className="mt-20 print:mt-0"
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
      <ul className="mt-8 flex flex-col gap-4">
        {items.map((item) => (
          <li key={`${item.postId}-${item.actionIndex}`}>
            <Link
              href={`/blog/${item.slug}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1 transition-colors duration-150 hover:bg-surface-2 print:break-inside-avoid"
            >
              {item.ogImagePath && !item.ogImageDeletedAt ? (
                // 29:10 banner image on TOP of each card. Earlier
                // attempts placed the image on the LEFT, but with
                // content always taller than a 29:10 thumbnail at
                // any reasonable width, image-left layouts left a
                // dead bg-surface-2 rectangle below the image. Image
                // on top fills the full card width with no possible
                // empty side-column. Card becomes a banner + content
                // block, stacked single-column in the section.
                <div className="relative aspect-[29/10] w-full bg-surface-2">
                  <Image
                    src={item.ogImagePath}
                    alt={item.ogImageAlt ?? item.title}
                    fill
                    sizes="(min-width: 768px) 800px, 100vw"
                    className="object-cover"
                    // priority=true disables next/image's default
                    // loading="lazy". The section sits below the
                    // fold of the diagnostic report; in the BROWSER
                    // that's fine, but the PDF route (Puppeteer)
                    // captures with a fixed viewport that never
                    // scrolls past the action plan, so lazy images
                    // never intersect → never fetch → PDF renders
                    // with blank image rectangles. With priority,
                    // images fetch immediately on page load
                    // regardless of viewport position. Cost: ~5
                    // additional fetches at initial page load
                    // (~250KB total). Negligible vs the cost of
                    // shipping CFOs a PDF with broken thumbnails.
                    priority
                  />
                </div>
              ) : null}
              <div className="flex flex-col p-6">
                {/* Per-card information hierarchy:
                 *    1. Category eyebrow (single short line; framing)
                 *    2. Title
                 *    3. Gloss — the ONLY content written for THIS exec,
                 *       for THIS report. Body weight, no decoration,
                 *       constrained to max-w-[60ch] so it reads as one
                 *       prose sentence at natural line length.
                 *    4. Footer: reading time
                 */}
                {item.categoryName ? (
                  <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
                    {item.categoryName}
                  </p>
                ) : null}
                <h3 className="mt-2 text-card-title text-ink visited:text-ink-muted">
                  {item.title}
                </h3>
                {item.gloss ? (
                  <p className="mt-3 max-w-[60ch] text-body text-ink-subtle">
                    {item.gloss}
                  </p>
                ) : (
                  // Gloss failed soft (Claude error, hallucinated id).
                  // Fall back to a truncated excerpt so the card still
                  // has substance under the title.
                  item.excerpt ? (
                    <p className="mt-3 max-w-[60ch] text-body-sm text-ink-subtle">
                      {truncateExcerpt(item.excerpt, 200)}
                    </p>
                  ) : null
                )}
                <p className="mt-auto pt-4 text-caption text-ink-tertiary">
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
