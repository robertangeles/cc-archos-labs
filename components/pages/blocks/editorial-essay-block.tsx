import type { EditorialEssayBlockProps } from "../../../lib/pages/blocks/schemas";

// Editorial essay block — full-bleed sales-surface treatment.
//
// Drops the "newspaper" chrome (section counters, bordered surfaces,
// even-column body). Lifts the visual hierarchy to match the hero:
//   - Heading is the dominant element at display-xl scale
//   - Lead paragraph is the second-loudest voice at body-lg+
//   - Body paragraphs collapse into a tight reading column
//   - Pull-quote (if provided) renders as a full-viewport-height
//     centered hero moment between the essay and the next section
//   - Mono signoff sits quietly at the end
//
// Scale drama is the move: heading takes a generous portion of the
// viewport, body sits in a 640px column below it, the pull-quote (when
// present) breaks out of the column to fill the page.

export function EditorialEssayBlock(props: EditorialEssayBlockProps) {
  const hasMiddleQuote =
    props.pullQuote && props.pullQuotePosition !== "end";
  const hasEndQuote = props.pullQuote && props.pullQuotePosition === "end";

  // Split body paragraphs around a mid-essay pull-quote.
  const halfPoint = Math.ceil(props.bodyParagraphs.length / 2);
  const beforeQuote = hasMiddleQuote
    ? props.bodyParagraphs.slice(0, halfPoint)
    : props.bodyParagraphs;
  const afterQuote = hasMiddleQuote
    ? props.bodyParagraphs.slice(halfPoint)
    : [];

  return (
    <>
      <section className="bg-canvas py-32 md:py-40">
        <div className="mx-auto max-w-[1280px] px-6 md:px-12">
          <h2 className="max-w-[1100px] text-display-lg text-ink md:text-display-xl">
            {props.heading}
          </h2>
          <div className="mt-16 max-w-[640px]">
            <p className="text-body-lg leading-[1.55] text-ink">
              {props.leadParagraph}
            </p>
            {beforeQuote.map((p, i) => (
              <p
                key={`pre-${i}`}
                className="mt-6 text-base leading-[1.7] text-ink-subtle"
              >
                {p}
              </p>
            ))}
          </div>
        </div>
      </section>

      {hasMiddleQuote ? <PullQuoteHero text={props.pullQuote!} /> : null}

      {afterQuote.length > 0 ? (
        <section className="bg-canvas pb-32 md:pb-40">
          <div className="mx-auto max-w-[1280px] px-6 md:px-12">
            <div className="max-w-[640px]">
              {afterQuote.map((p, i) => (
                <p
                  key={`post-${i}`}
                  className="mt-6 text-base leading-[1.7] text-ink-subtle"
                >
                  {p}
                </p>
              ))}
              {props.signoff ? (
                <p className="mt-16 font-mono text-caption uppercase tracking-[0.2em] text-ink-tertiary">
                  {props.signoff}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {hasEndQuote ? <PullQuoteHero text={props.pullQuote!} /> : null}

      {hasEndQuote && props.signoff ? (
        <section className="bg-canvas pb-32">
          <div className="mx-auto max-w-[1280px] px-6 md:px-12">
            <p className="font-mono text-caption uppercase tracking-[0.2em] text-ink-tertiary">
              {props.signoff}
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}

// Pull-quote rendered as a viewport-filling hero moment. Centered, no
// quote marks, no left rule — just the line at huge scale on the
// canvas. Top + bottom hairlines as architectural punctuation.
function PullQuoteHero({ text }: { text: string }) {
  return (
    <section className="border-y border-hairline bg-canvas py-32 md:py-48">
      <div className="mx-auto max-w-[1280px] px-6 md:px-12">
        <p className="max-w-[1100px] text-display-lg italic leading-[1.05] text-ink md:text-display-xl">
          {text}
        </p>
      </div>
    </section>
  );
}
