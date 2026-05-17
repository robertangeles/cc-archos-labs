"use client";

// Desktop-only "Jump to: Services · Proof · Assessment" anchor strip under
// the hero. Honours the speed-signals-respect principle from CLAUDE.md —
// time-poor readers can skip ahead without scrolling the whole page.
//
// "use client" so we can fire analytics on each anchor click. Smooth scroll
// is handled in CSS via `scroll-behavior: smooth` on <html> + a
// `scroll-padding-top` offset for the sticky header (set globally in
// globals.css if needed). Native browser jump is the no-JS fallback.

import { track } from "../../../lib/analytics";

export type AnchorNavProps = {
  items: { label: string; href: string }[];
};

export function AnchorNav({ items }: AnchorNavProps) {
  return (
    <nav
      aria-label="Jump to section"
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      <span className="text-caption uppercase text-ink-tertiary">Jump to</span>
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-x-2">
          <a
            href={item.href}
            onClick={() =>
              track("anchor.nav.clicked", {
                target: item.href.replace(/^#/, ""),
              })
            }
            className="rounded-full border border-hairline px-3 py-1 text-caption text-ink-subtle transition-colors duration-150 hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {item.label}
          </a>
          {i < items.length - 1 ? (
            <span aria-hidden className="text-ink-tertiary">
              ·
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}
