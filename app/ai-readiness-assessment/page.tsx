import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI Readiness Assessment — Archos Labs",
  description:
    "A free executive diagnostic scoring your AI program across data foundation, program readiness, and organisational reality. Practitioner report in your inbox.",
};

export default function AIReadinessAssessmentPage() {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <article className="mx-auto w-full max-w-[760px] px-6 pt-24 pb-32 md:px-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
          AI Readiness Assessment
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-fg md:text-[56px]">
          Find out where your gaps are.
        </h1>
        <p className="mt-6 max-w-[620px] text-[18px] leading-[1.6] text-muted">
          A free executive diagnostic. About eight minutes. A written
          practitioner report scoring your program across data foundation,
          program readiness, and organisational reality.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          What you get
        </h2>
        <ul className="mt-6 space-y-4 text-base leading-[1.7] text-muted">
          <li>
            <span className="text-fg">A verdict.</span> One sentence on where
            your program actually sits — Critical, Emerging, Developing, or
            Advanced.
          </li>
          <li>
            <span className="text-fg">Domain scores.</span> Data Foundation,
            Program Readiness, Org Reality. The three lenses that predict
            whether AI work sticks.
          </li>
          <li>
            <span className="text-fg">A practitioner narrative.</span>{" "}
            Plain-language analysis of what your answers actually mean.
            References your own words, not a template.
          </li>
          <li>
            <span className="text-fg">Priority actions.</span> Three to five
            sequenced moves, with time horizons. What to do first. What to do
            next. What can wait.
          </li>
        </ul>
        <p className="mt-8 text-base leading-[1.7] text-muted">
          No pitch deck. No qualification gauntlet.
        </p>
        <p className="mt-8 text-[13px] font-medium uppercase tracking-[0.08em] text-muted">
          Launching soon
        </p>

        <h2 className="mt-20 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Need answers before then?
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          The full Assessment is a two-week paid consulting engagement. We map
          your data, governance, and AI surface area against what&rsquo;s
          viable and deliver a written assessment you can take to your CFO or
          your board. Fixed price{" "}
          <span className="text-fg">$3,000 AUD</span>. No retainer. No upsell.
        </p>

        <Link
          href="/contact"
          className="mt-12 inline-flex items-center rounded-md bg-accent px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
        >
          Book a call
        </Link>
      </article>
    </main>
  );
}
