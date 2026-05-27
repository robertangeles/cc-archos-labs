// Philosophy section block — "What I believe" on the May 2026 /about
// rewrite. Renders a centered paragraph + a hairline-bordered pull
// quote + a second centered paragraph. No quotation marks on the pull
// quote — the borders carry it. Reads as a statement of values, not
// a sales pitch.

import type { ReactNode } from "react";

export type PhilosophyBlockProps = {
  /** Pre-quote paragraph (body-lg, ink-muted, centered). */
  introParagraph: ReactNode;
  /** The pull quote itself — display-md, no quote marks, hairline borders
   *  top and bottom. */
  pullQuote: ReactNode;
  /** Post-quote paragraph (body-lg, ink-muted, centered). */
  outroParagraph: ReactNode;
};

export function PhilosophyBlock({
  introParagraph,
  pullQuote,
  outroParagraph,
}: PhilosophyBlockProps) {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col items-center gap-10 text-center">
      <p className="text-body-lg leading-relaxed text-ink-muted">
        {introParagraph}
      </p>
      <blockquote className="w-full border-y border-hairline py-10 text-display-md text-ink">
        {pullQuote}
      </blockquote>
      <p className="text-body-lg leading-relaxed text-ink-muted">
        {outroParagraph}
      </p>
    </div>
  );
}
