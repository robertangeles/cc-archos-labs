"use client";

import { motion } from "framer-motion";

const TOPICS = [
  { topic: "Data Governance", pct: 11 },
  { topic: "Data Modelling and Design", pct: 11 },
  { topic: "Data Quality", pct: 11 },
  { topic: "Metadata Management", pct: 11 },
  { topic: "Master and Reference Data Management", pct: 10 },
  { topic: "Data Warehousing and Business Intelligence", pct: 10 },
  { topic: "Data Architecture", pct: 6 },
  { topic: "Data Storage and Operations", pct: 6 },
  { topic: "Data Security", pct: 6 },
  { topic: "Data Integration and Interoperability", pct: 6 },
  { topic: "Document and Content Management", pct: 6 },
  { topic: "Data Ethics", pct: 2 },
  { topic: "Big Data", pct: 2 },
  { topic: "Data Management Process", pct: 2 },
];

export function LandingHero({ onStart }: { onStart: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-1 flex-col bg-canvas px-6 py-24 md:px-12 md:py-32"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col">
        <p className="uppercase text-eyebrow text-ink-subtle">
          CDMP Practice Exam
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink md:text-[64px]">
          Practice for the CDMP.
          <br />
          <span className="text-primary">Know where you stand.</span>
        </h1>
        <p className="mt-8 max-w-[600px] text-[18px] leading-[1.6] text-ink-subtle">
          Free practice exams for the CDMP Fundamentals certification by DAMA
          International. Questions generated from DMBOK content, scored against
          the real exam&apos;s chapter weightings. See exactly which knowledge
          areas need more study.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { level: "Associate", score: "60%", desc: "Fundamentals only" },
            { level: "Practitioner", score: "70%", desc: "Fundamentals + 2 specialist" },
            { level: "Master", score: "80%", desc: "Fundamentals + 2 specialist + experience" },
          ].map((tier) => (
            <div
              key={tier.level}
              className="rounded-lg border border-hairline bg-surface-1 px-5 py-4"
            >
              <p className="text-sm font-medium text-ink">{tier.level}</p>
              <p className="mt-1 text-2xl font-semibold text-primary">
                {tier.score}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">{tier.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Left: CTA + announcements */}
          <div className="flex flex-col justify-between gap-4">
            <div className="rounded-lg border border-semantic-success/20 bg-semantic-success/5 px-5 py-4">
              <p className="text-sm font-medium text-semantic-success">
                Free for early adopters
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-subtle">
                This practice exam is free for the first 3 months. Sign up during this period and it stays free for you forever.
              </p>
            </div>

            <div className="rounded-lg border border-hairline bg-surface-1 px-5 py-4">
              <p className="text-sm font-medium text-ink">
                Specialist Practice Exams
              </p>
              <p className="mt-1 text-[13px] text-ink-subtle">
                Coming soon. Targeted practice for each of the 14 DMBOK knowledge areas.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 pt-2">
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center rounded-md bg-primary px-8 py-3.5 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
              >
                Start practicing
              </button>
              <p className="text-[13px] text-ink-subtle">
                100 questions &middot; 5 choices &middot; 90 minutes &middot; Open book
                <br />
                Shorter sessions: 20, 40, or 60 questions.
              </p>
            </div>
          </div>

          {/* Right: Exam coverage */}
          <div>
            <p className="text-sm font-medium text-ink">Exam coverage by DMBOK topic</p>
            <p className="mt-1 text-[11px] text-ink-subtle">14 chapters. Weighted to match the real exam.</p>
            <div className="mt-4 space-y-2">
              {TOPICS.map((item) => (
                <div key={item.topic} className="flex items-center gap-2">
                  <div className="h-1.5 w-20 shrink-0 rounded-full bg-ink-subtle/10">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${item.pct * 9}%` }}
                    />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-subtle">
                    {item.topic}
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-ink-subtle">
                    {item.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
