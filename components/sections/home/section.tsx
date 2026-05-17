// Generic section container — wraps a <section> with the home-page rhythm
// constants (max-width, padding, optional anchor id). Each home page section
// uses this so the page composition stays focused on copy + sub-components.
//
// Background variants:
//   - `canvas` (default)    — base dark background
//   - `surface-1`           — one step up the surface ladder
//   - `elevated`            — surface-2; used by the Assessment Block to
//                              signal "this is a distinct moment"
//   - `bordered`            — surface-1 with hairline top + bottom borders
//                              (used by the Final CTA section)

import type { ReactNode } from "react";

type Bg = "canvas" | "surface-1" | "elevated" | "bordered";

type SectionProps = {
  /** Anchor id (rendered on the outer <section>). Used by the desktop
   *  AnchorNav links. Omit for sections that aren't anchor targets. */
  id?: string;
  bg?: Bg;
  /** Vertical padding. `tight` matches the original "What we do" rhythm.
   *  `relaxed` matches the Final CTA's larger breathing room. Default `tight`. */
  pad?: "tight" | "relaxed";
  children: ReactNode;
  /** Center the inner content horizontally. Defaults to false (left-aligned
   *  block flow). */
  centered?: boolean;
};

const bgClass: Record<Bg, string> = {
  canvas: "bg-canvas",
  "surface-1": "bg-surface-1",
  elevated: "bg-surface-2",
  bordered: "border-y border-hairline bg-surface-1",
};

const padClass = {
  tight: "py-12",
  relaxed: "py-32",
};

export function Section({
  id,
  bg = "canvas",
  pad = "tight",
  centered = false,
  children,
}: SectionProps) {
  return (
    <section id={id} className={bgClass[bg]}>
      <div
        className={`mx-auto max-w-[1080px] px-6 ${padClass[pad]} md:px-12 ${
          centered ? "text-center" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}
