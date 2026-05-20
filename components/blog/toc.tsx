"use client";

import { useEffect, useState } from "react";
import type { TocHeading } from "../../lib/post-rendering";

// Table of contents for the post page. Two presentations off the same
// data — sticky right column on desktop, slide-up drawer on mobile.
// Hidden entirely when the post has fewer than 3 headings (a TOC for a
// 2-heading post is noise).
//
// Active-heading tracking uses IntersectionObserver — element nearest
// the top of the viewport gets `aria-current="location"` + lavender ink.

export interface TocProps {
  headings: TocHeading[];
}

export function Toc({ headings }: TocProps) {
  const [activeId, setActiveId] = useState<string | null>(
    headings[0]?.id ?? null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (headings.length < 3) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: [0, 1] },
    );
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 3) return null;

  return (
    <>
      <aside
        aria-label="Table of contents"
        className="sticky top-24 hidden max-h-[calc(100vh-8rem)] overflow-y-auto pl-8 lg:block"
      >
        <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
          On this page
        </p>
        <ul className="mt-4 space-y-2 border-l border-hairline">
          {headings.map((h) => (
            <li
              key={h.id}
              className={h.level === 3 ? "pl-6" : "pl-4"}
            >
              <a
                href={`#${h.id}`}
                aria-current={
                  activeId === h.id ? "location" : undefined
                }
                className={`block text-body-sm transition-colors duration-150 ${
                  activeId === h.id
                    ? "text-ink"
                    : "text-ink-subtle hover:text-ink"
                }`}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      {/* Mobile drawer trigger — floating bottom-left button */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open table of contents"
        className="fixed bottom-6 left-6 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-surface-1 text-ink-subtle shadow-lg shadow-black/40 lg:hidden"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <path d="M4 6h12M4 10h12M4 14h8" strokeLinecap="round" />
        </svg>
      </button>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close table of contents"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-semantic-overlay/60"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-lg border-t border-hairline bg-surface-2 px-6 pt-6 pb-12">
            <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
              On this page
            </p>
            <ul className="mt-4 space-y-3">
              {headings.map((h) => (
                <li key={h.id} className={h.level === 3 ? "pl-4" : ""}>
                  <a
                    href={`#${h.id}`}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={
                      activeId === h.id ? "location" : undefined
                    }
                    className={`block text-body transition-colors duration-150 ${
                      activeId === h.id
                        ? "text-ink"
                        : "text-ink-subtle"
                    }`}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
