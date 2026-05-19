import { Fragment } from "react";
import type { StatBandBlockProps } from "../../../lib/pages/blocks/schemas";

// Stat band — full-width 3-column stat strip. Surface-1 background,
// hairline top + bottom, vertical hairline dividers between columns on
// desktop. Stacks vertically on mobile with horizontal hairline
// dividers replacing the verticals.
//
// Typography pulled from DESIGN.md tokens:
//   - Eyebrow: text-eyebrow (13px / 500 / +0.4 tracking) + text-primary uppercase
//   - Number: text-display-xl (80px / 600 / -3px / line-height 1.05)
//   - Unit: inline 32px / 400 / -0.5px / ink-muted (no project token at
//     exactly 32px/400; treated as a one-off)
//   - Subtext: text-body-sm (14px / 400) + text-ink-subtle
//
// Dividers render inline between column siblings using a flex sequence.
// On mobile (flex-col), the divider becomes a full-width horizontal
// hairline; on desktop (flex-row), it becomes a fixed-height vertical
// hairline.

export function StatBandBlock(props: StatBandBlockProps) {
  return (
    <section className="w-full border-y border-hairline bg-surface-1">
      <div className="mx-auto flex max-w-[1280px] flex-col md:flex-row md:items-center md:px-8 lg:px-0">
        {props.stats.map((stat, idx) => (
          <Fragment key={idx}>
            {idx > 0 ? <Divider /> : null}
            <StatColumn {...stat} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function StatColumn({
  eyebrow,
  number,
  unit,
  subtext,
}: {
  eyebrow: string;
  number: string;
  unit: string;
  subtext: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10 text-center md:px-12 md:py-16">
      <span className="font-mono text-eyebrow uppercase tracking-[0.15em] text-primary">
        {eyebrow}
      </span>
      {/*
        Balance fix: number font-size is uniform across all stats so digit
        count doesn't drive perceived weight. tabular-nums forces uniform
        digit width so "25" and "3" feel rhythmically balanced.
        Font-size capped at text-display-lg (56px) — display-xl at 80px
        made multi-digit numbers visually dominate the column.
      */}
      <div className="mt-4 flex items-baseline justify-center gap-x-2">
        <span
          className="text-display-lg leading-none text-ink"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {number}
        </span>
        <span
          className="leading-none text-ink-muted"
          style={{
            fontSize: "clamp(18px, 2.4vw, 26px)",
            fontWeight: 400,
            letterSpacing: "-0.5px",
          }}
        >
          {unit}
        </span>
      </div>
      <span className="mt-3 max-w-[280px] text-body-sm text-ink-subtle">
        {subtext}
      </span>
    </div>
  );
}

function Divider() {
  // Mobile: full-width horizontal hairline. Desktop: 1px-wide vertical
  // hairline at 80px tall. Aria-hidden because it carries no semantic
  // meaning.
  return (
    <span
      aria-hidden
      className="h-px w-full bg-hairline md:h-20 md:w-px"
    />
  );
}
