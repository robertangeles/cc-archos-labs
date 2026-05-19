import Link from "next/link";
import type { ClosingStatementBlockProps } from "../../../lib/pages/blocks/schemas";

// Closing statement — pull-quote IS the hero. Everything else trimmed.
//
// The closing line ("Not everyone gets the call. That is the point.")
// fills the viewport at display-xl. No eyebrow chrome, no surface
// boxes, no decorative rules. The line, then the CTAs, then nothing.

export function ClosingStatementBlock(props: ClosingStatementBlockProps) {
  return (
    <section className="border-t border-hairline bg-canvas py-32 md:py-48">
      <div className="mx-auto max-w-[1280px] px-6 md:px-12">
        {props.pullQuote ? (
          <p className="max-w-[1100px] text-display-lg italic leading-[1.05] text-ink md:text-display-xl">
            &ldquo;{props.pullQuote}&rdquo;
          </p>
        ) : (
          <h2 className="max-w-[1100px] text-display-lg leading-[1.05] text-ink md:text-display-xl">
            {props.heading}
          </h2>
        )}

        <p className="mt-12 max-w-[640px] text-body-lg leading-[1.55] text-ink-subtle">
          {props.leadParagraph}
        </p>

        <div className="mt-16 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link
            href={props.primaryCta.href}
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-4 text-button text-white transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {props.primaryCta.label}
          </Link>
          {props.secondaryCta ? (
            <Link
              href={props.secondaryCta.href}
              className="inline-flex items-center justify-center rounded-md border border-hairline-strong px-8 py-4 text-button text-ink transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {props.secondaryCta.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
