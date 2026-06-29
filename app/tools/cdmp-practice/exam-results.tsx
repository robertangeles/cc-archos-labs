"use client";

import { useState, useEffect, useRef } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from "framer-motion";
import type { ExamResult, ChapterScore } from "@/lib/cdmp/scoring";

export interface AnswerDetail {
  questionIndex: number;
  questionText: string;
  options: Array<{ code: string; label: string }>;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  knowledgeArea: string;
  explanation: string;
  dmbokChapterRef: string;
}

interface ExamResultsProps {
  result: ExamResult;
  answers: AnswerDetail[];
  onRetry: () => void;
  onPracticeWeak?: (weakChapters: string[]) => void;
}

function scoreToColor(percent: number): string {
  if (percent < 0) return "var(--color-hairline-strong)";
  if (percent >= 80) return "var(--color-semantic-success)";
  if (percent >= 60) return "var(--color-semantic-warning)";
  return "var(--color-semantic-error)";
}

function scoreToTailwind(percent: number): string {
  if (percent < 0) return "text-ink-tertiary";
  if (percent >= 80) return "text-semantic-success";
  if (percent >= 60) return "text-semantic-warning";
  return "text-semantic-error";
}

function getNextTier(result: ExamResult): { label: string; gap: number } | null {
  if (result.thresholds.master.passed) return null;
  if (result.thresholds.practitioner.passed)
    return { label: "Master", gap: result.thresholds.master.score - result.percentCorrect };
  if (result.thresholds.associate.passed)
    return { label: "Practitioner", gap: result.thresholds.practitioner.score - result.percentCorrect };
  return { label: "Associate", gap: result.thresholds.associate.score - result.percentCorrect };
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

const ARC_START = 135;
const ARC_END = 405;
const ARC_CX = 100;
const ARC_CY = 100;
const ARC_R = 85;
const ARC_TOTAL_ANGLE = ARC_END - ARC_START;

function AnimatedCounter({
  target,
  duration,
  delay,
  reducedMotion,
}: {
  target: number;
  duration: number;
  delay: number;
  reducedMotion: boolean;
}) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v));
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reducedMotion) {
      motionVal.set(target);
      if (displayRef.current) displayRef.current.textContent = `${target}`;
      return;
    }
    const controls = animate(motionVal, target, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [target, duration, delay, reducedMotion, motionVal]);

  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      if (displayRef.current) displayRef.current.textContent = `${v}`;
    });
    return unsubscribe;
  }, [rounded]);

  return (
    <span ref={displayRef} aria-hidden="true">
      {reducedMotion ? target : 0}
    </span>
  );
}

const MILESTONES = [
  { label: "Associate", short: "Assoc.", score: 60, color: "text-semantic-warning" },
  { label: "Practitioner", short: "Pract.", score: 70, color: "text-primary" },
  { label: "Master", short: "Master", score: 80, color: "text-semantic-success" },
];

const EASE_OUT_CUSTOM: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ── Radar chart helpers ── */

const RADAR_CX = 250;
const RADAR_CY = 250;
const RADAR_R = 130;
const RADAR_RINGS = [20, 40, 60, 80, 100];

function radarPoint(cx: number, cy: number, r: number, index: number, total: number) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function radarPolygon(cx: number, cy: number, maxR: number, values: number[], total: number) {
  return values
    .map((v, i) => {
      const clamped = Math.max(0, Math.min(v, 100));
      const r = (clamped / 100) * maxR;
      const pt = radarPoint(cx, cy, r, i, total);
      return `${pt.x},${pt.y}`;
    })
    .join(" ");
}

function radarRingPolygon(cx: number, cy: number, r: number, total: number) {
  return Array.from({ length: total }, (_, i) => {
    const pt = radarPoint(cx, cy, r, i, total);
    return `${pt.x},${pt.y}`;
  }).join(" ");
}

function shortenLabel(label: string): string {
  const map: Record<string, string> = {
    "Data Governance": "Governance",
    "Data Modelling and Design": "Modelling",
    "Data Modelling & Design": "Modelling",
    "Data Quality": "Quality",
    "Metadata Management": "Metadata",
    "Master and Reference Data": "Reference",
    "Master & Reference Data": "Reference",
    "Data Warehousing and Business Intelligence": "Warehousing",
    "Data Warehousing & BI": "Warehousing",
    "Data Warehousing & Business Intelligence": "Warehousing",
    "Data Architecture": "Architecture",
    "Data Storage and Operations": "Storage",
    "Data Storage & Operations": "Storage",
    "Data Security": "Security",
    "Data Integration and Interoperability": "Integration",
    "Data Integration & Interoperability": "Integration",
    "Document and Content Management": "Documents",
    "Document & Content Management": "Documents",
    "Data Ethics": "Ethics",
    "Big Data": "Big Data",
    "Big Data and Data Science": "Big Data",
    "Big Data & Data Science": "Big Data",
    "Data Management Process": "Process",
  };
  return map[label] ?? label;
}

function RadarChart({
  chapters,
  activeSlug,
  onSelect,
}: {
  chapters: ChapterScore[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const n = chapters.length;
  if (n < 3) return null;

  const values = chapters.map((c) => c.percentCorrect);
  const scorePolygon = radarPolygon(RADAR_CX, RADAR_CY, RADAR_R, values, n);

  return (
    <svg viewBox="0 0 500 500" className="mx-auto w-full max-w-[420px]" role="img" aria-label="Radar chart showing performance across DMBOK chapters">
      <defs>
        {/* Gradient fill for score polygon */}
        <radialGradient id="radar-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.05" />
          <stop offset="70%" stopColor="var(--color-primary)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.3" />
        </radialGradient>
        {/* Glow filter for vertex dots */}
        <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        {/* Stronger glow for active dot */}
        <filter id="dot-glow-active" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Concentric grid rings */}
      {RADAR_RINGS.map((pct) => (
        <polygon
          key={pct}
          points={radarRingPolygon(RADAR_CX, RADAR_CY, (pct / 100) * RADAR_R, n)}
          fill="none"
          stroke={pct === 60 ? "var(--color-semantic-warning)" : "var(--color-hairline)"}
          strokeWidth={pct === 60 ? "2" : "0.5"}
          strokeDasharray={pct === 60 ? "6 4" : "none"}
          opacity={pct === 60 ? 0.6 : 0.3}
        />
      ))}

      {/* Axis lines */}
      {chapters.map((_, i) => {
        const pt = radarPoint(RADAR_CX, RADAR_CY, RADAR_R, i, n);
        return (
          <line
            key={i}
            x1={RADAR_CX}
            y1={RADAR_CY}
            x2={pt.x}
            y2={pt.y}
            stroke="var(--color-hairline)"
            strokeWidth="0.5"
            opacity="0.25"
          />
        );
      })}

      {/* Score polygon with gradient fill */}
      <motion.polygon
        points={scorePolygon}
        fill="url(#radar-gradient)"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
      />

      {/* Vertex dots with SVG filter glow */}
      {chapters.map((chapter, i) => {
        const isTested = chapter.percentCorrect >= 0;
        const pct = Math.max(0, chapter.percentCorrect);
        const r = (Math.min(pct, 100) / 100) * RADAR_R;
        const pt = radarPoint(RADAR_CX, RADAR_CY, r, i, n);
        const isActive = activeSlug === chapter.slug;
        const dotColor = scoreToColor(chapter.percentCorrect);

        if (!isTested) {
          const edgePt = radarPoint(RADAR_CX, RADAR_CY, 0, i, n);
          return (
            <g key={chapter.slug} className="cursor-pointer opacity-40" onClick={() => onSelect(chapter.slug)}>
              <circle cx={edgePt.x} cy={edgePt.y} r={3} fill="none" stroke="var(--color-hairline-strong)" strokeWidth="1.5" strokeDasharray="2 2" />
            </g>
          );
        }

        return (
          <g key={chapter.slug} className="cursor-pointer" onClick={() => onSelect(chapter.slug)}>
            <circle cx={pt.x} cy={pt.y} r={isActive ? 8 : 5} fill={dotColor} filter={isActive ? "url(#dot-glow-active)" : "url(#dot-glow)"} opacity={0.6} />
            <circle cx={pt.x} cy={pt.y} r={isActive ? 5 : 3.5} fill={dotColor} stroke={isActive ? "var(--color-primary)" : "var(--color-canvas)"} strokeWidth={isActive ? 2 : 1} />
          </g>
        );
      })}

      {/* Axis labels */}
      {chapters.map((chapter, i) => {
        const labelR = RADAR_R + 40;
        const pt = radarPoint(RADAR_CX, RADAR_CY, labelR, i, n);
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const angleDeg = (angle * 180) / Math.PI;
        const isRight = angleDeg > -90 && angleDeg < 90;
        const isTop = Math.abs(angleDeg + 90) < 15;
        const isBottom = Math.abs(angleDeg - 90) < 15;
        const isActive = activeSlug === chapter.slug;
        const isTested = chapter.percentCorrect >= 0;
        return (
          <text
            key={chapter.slug}
            x={pt.x}
            y={pt.y}
            textAnchor={isTop || isBottom ? "middle" : isRight ? "start" : "end"}
            dominantBaseline="central"
            className={`text-[11px] cursor-pointer transition-all ${isActive ? "fill-primary font-bold" : isTested ? "fill-ink-muted font-medium" : "fill-ink-tertiary"}`}
            onClick={() => onSelect(chapter.slug)}
          >
            {shortenLabel(chapter.label)}
          </text>
        );
      })}

      {/* 60% threshold label */}
      <text x={RADAR_CX + 4} y={RADAR_CY - (60 / 100) * RADAR_R - 6} textAnchor="start" className="fill-semantic-warning/70 text-[10px] font-medium">
        60% pass
      </text>
    </svg>
  );
}

/* ── Main component ── */

export function ExamResults({ result, answers, onRetry, onPracticeWeak }: ExamResultsProps) {
  // T2: Auto-select first incorrect question on load
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(() => {
    const sorted = [...answers].sort((a, b) => a.questionIndex - b.questionIndex);
    const firstIncorrect = sorted.find((a) => !a.isCorrect);
    return firstIncorrect ? firstIncorrect.questionIndex : (sorted.length > 0 ? sorted[0].questionIndex : null);
  });
  const [filterChapter, setFilterChapter] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion() ?? false;

  const sortedAnswers = [...answers].sort(
    (a, b) => a.questionIndex - b.questionIndex,
  );
  const filteredAnswers = filterChapter
    ? sortedAnswers.filter((a) => a.knowledgeArea === filterChapter)
    : sortedAnswers;

  const selected = sortedAnswers.find(
    (a) => a.questionIndex === selectedQuestion,
  );

  const bestThreshold = result.thresholds.master.passed
    ? "Master"
    : result.thresholds.practitioner.passed
      ? "Practitioner"
      : result.thresholds.associate.passed
        ? "Associate"
        : null;

  const nextTier = getNextTier(result);
  const color = scoreToColor(result.percentCorrect);

  const bgArcPath = describeArc(ARC_CX, ARC_CY, ARC_R, ARC_START, ARC_END);
  const circumference = 2 * Math.PI * ARC_R;
  const arcLength = circumference * (ARC_TOTAL_ANGLE / 360);
  const scoreFraction = Math.min(result.percentCorrect, 100) / 100;

  const d = (base: number) => (prefersReducedMotion ? 0 : base);

  const radarChapters = [...result.perChapter].sort((a, b) => a.slug.localeCompare(b.slug));
  const sortedChapters = [...result.perChapter].sort(
    (a, b) => a.percentCorrect - b.percentCorrect,
  );

  const weakChapters = result.perChapter.filter((c) => c.totalQuestions > 0 && c.percentCorrect < 60).map((c) => c.slug);

  const activeChapter = filterChapter
    ? result.perChapter.find((c) => c.slug === filterChapter)
    : null;

  const correctInFilter = filterChapter
    ? filteredAnswers.filter((a) => a.isCorrect).length
    : null;
  const totalInFilter = filterChapter ? filteredAnswers.length : null;

  function handleChapterSelect(slug: string) {
    const newFilter = filterChapter === slug ? null : slug;
    setFilterChapter(newFilter);
    const pool = newFilter
      ? sortedAnswers.filter((a) => a.knowledgeArea === newFilter)
      : sortedAnswers;
    const firstIncorrect = pool.find((a) => !a.isCorrect);
    setSelectedQuestion(firstIncorrect?.questionIndex ?? pool[0]?.questionIndex ?? null);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: d(0.3) }}
      className="flex flex-1 flex-col bg-canvas px-4 py-8 md:px-8 md:py-12 lg:px-12"
    >
      <div className="mx-auto w-full max-w-[1080px]">

        {/* ═══ Score Header Bar ═══ */}
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-10">
          {/* T3: Arc gauge with micro-pulse */}
          <motion.div
            className="relative h-36 w-36 shrink-0 md:h-40 md:w-40"
            animate={prefersReducedMotion ? {} : { scale: [1, 1, 1, 1.03, 1] }}
            transition={{ duration: 1.8, delay: 0.2, times: [0, 0.75, 0.78, 0.85, 1], ease: "easeInOut" }}
          >
            <svg
              viewBox="0 0 200 200"
              className="h-full w-full"
              role="img"
              aria-label={`Score: ${result.percentCorrect} percent`}
            >
              <path d={bgArcPath} fill="none" stroke="var(--color-hairline)" strokeWidth="8" strokeLinecap="round" aria-hidden="true" />
              {result.percentCorrect > 0 && (
                <motion.path
                  d={bgArcPath}
                  fill="none"
                  stroke={color}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={arcLength}
                  strokeDashoffset={arcLength * (1 - scoreFraction)}
                  initial={{ strokeDashoffset: arcLength }}
                  animate={{ strokeDashoffset: arcLength * (1 - scoreFraction) }}
                  transition={{ duration: d(1.2), delay: d(0.2), ease: EASE_OUT_CUSTOM }}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-headline md:text-display-md font-semibold ${scoreToTailwind(result.percentCorrect)}`} aria-label={`${result.percentCorrect} percent`}>
                <AnimatedCounter target={result.percentCorrect} duration={d(1.2)} delay={d(0.2)} reducedMotion={prefersReducedMotion} />
                <span aria-hidden="true">%</span>
              </span>
            </div>
          </motion.div>

          {/* Stats + tier track */}
          <div className="flex min-w-0 flex-1 flex-col items-center md:items-start md:pt-2">
            <div className="flex flex-wrap items-center gap-3">
              {bestThreshold ? (
                <span className="inline-block rounded-full bg-semantic-success/15 px-3 py-1 text-sm font-medium text-semantic-success">
                  {bestThreshold} level reached
                </span>
              ) : (
                <span className="inline-block rounded-full bg-semantic-error/15 px-3 py-1 text-sm font-medium text-semantic-error">
                  Below Associate threshold
                </span>
              )}
              <span className="text-body-sm text-ink-subtle">
                {result.correctCount}/{result.totalQuestions} correct
              </span>
            </div>

            {/* T5: Tier milestone track — normalized to 50-100% range for visual spread */}
            <div className="mt-5 w-full max-w-[480px]" role="img" aria-label={`Score progress: ${result.percentCorrect}%. ${nextTier ? `${nextTier.gap} points to ${nextTier.label}.` : "Master level reached."}`}>
              <div className="relative h-16">
                <div className="absolute left-0 right-0 top-4 h-px bg-hairline" />
                <motion.div
                  className="absolute left-0 top-4 h-px origin-left"
                  style={{ backgroundColor: color }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${Math.max(0, Math.min((result.percentCorrect - 50) * 2, 100))}%` }}
                  transition={{ duration: d(0.8), delay: d(1.0), ease: EASE_OUT_CUSTOM }}
                />
                {MILESTONES.map((m, idx) => {
                  const passed = m.score === 60 ? result.thresholds.associate.passed : m.score === 70 ? result.thresholds.practitioner.passed : result.thresholds.master.passed;
                  const stagger = idx === 1 ? "-top-6" : "top-6";
                  const pos = (m.score - 50) * 2;
                  return (
                    <div key={m.score} className="absolute top-4 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos}%` }}>
                      <div className={`h-2.5 w-2.5 rounded-full border-2 ${passed ? "border-semantic-success bg-semantic-success" : "border-hairline-strong bg-surface-1"}`} />
                      <span className={`absolute left-1/2 ${stagger} -translate-x-1/2 whitespace-nowrap text-[10px] font-medium ${m.color}`}>{m.label} {m.score}%</span>
                    </div>
                  );
                })}
                <motion.div
                  className="absolute top-4 -translate-x-1/2 -translate-y-1/2"
                  initial={{ left: "0%" }}
                  animate={{ left: `${Math.max(0, Math.min((result.percentCorrect - 50) * 2, 100))}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 20, delay: d(1.0) }}
                >
                  <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px 3px color-mix(in srgb, ${color} 40%, transparent)` }} />
                </motion.div>
              </div>
              <p className="text-[11px] text-ink-subtle">
                {nextTier ? `${nextTier.gap} point${nextTier.gap !== 1 ? "s" : ""} to ${nextTier.label}` : "Master level reached"}
              </p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="hidden shrink-0 flex-col gap-3 border-l border-hairline pl-8 pt-2 lg:flex">
            {(() => {
              const tested = sortedChapters.filter((c) => c.totalQuestions > 0);
              const strongest = tested.length > 0 ? tested[tested.length - 1] : null;
              const weakest = tested.length > 0 ? tested[0] : null;
              const perfectCount = tested.filter((c) => c.percentCorrect === 100).length;
              return (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Strongest</p>
                    <p className="text-[13px] font-medium text-semantic-success">{strongest ? shortenLabel(strongest.label) : "—"}</p>
                  </div>
                  {weakest && weakest.slug !== strongest?.slug && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Weakest</p>
                      <p className={`text-[13px] font-medium ${weakest.percentCorrect < 60 ? "text-semantic-error" : "text-semantic-warning"}`}>{shortenLabel(weakest.label)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Chapters at 100%</p>
                    <p className="text-[13px] font-medium text-ink">{perfectCount}/{tested.length}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Below pass</p>
                    <p className={`text-[13px] font-medium ${weakChapters.length > 0 ? "text-semantic-error" : "text-ink"}`}>{weakChapters.length} chapter{weakChapters.length !== 1 ? "s" : ""}</p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* ═══ Dashboard: Radar + Chapters | Question Review ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: d(0.25), delay: d(0.8) }}
          className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]"
        >
          {/* ── Left Column: Subject Mastery (specialist) | Radar + Chapters (fundamentals) ── */}
          {result.examType === "specialist" ? (
            <div>
              <h3 className="text-body-sm font-semibold text-ink">Subject mastery</h3>
              <div className="mt-3 rounded-lg border border-hairline bg-surface-1 px-6 py-8 text-center">
                <p className="text-body-sm text-ink-subtle">{result.specialistLabel}</p>
                <p className={`mt-2 text-2xl font-semibold ${scoreToTailwind(result.percentCorrect)}`}>
                  {bestThreshold ?? "Below Associate"}
                </p>
                <p className="mt-1 text-body-sm text-ink-subtle">
                  {result.percentCorrect}% · {result.correctCount}/{result.totalQuestions} correct
                </p>
                {nextTier && (
                  <p className="mt-3 text-[12px] text-ink-subtle">
                    {nextTier.gap} more point{nextTier.gap !== 1 ? "s" : ""} to {nextTier.label}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover"
              >
                Try again
              </button>
            </div>
          ) : (
          <div>
            <h3 className="text-body-sm font-semibold text-ink">
              Competency Profile
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              Click a chapter to filter questions. Dashed ring = 60% pass threshold.
            </p>

            {/* Radar Chart */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: d(0.5), delay: d(0.9) }}
              className="mt-3"
            >
              <RadarChart
                chapters={radarChapters}
                activeSlug={filterChapter}
                onSelect={handleChapterSelect}
              />
            </motion.div>

            {filterChapter && (
              <div className="mt-3 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-[12px] font-medium text-ink">
                  {activeChapter?.label} · {correctInFilter}/{totalInFilter} correct
                </span>
                <button
                  type="button"
                  onClick={() => handleChapterSelect(filterChapter!)}
                  className="text-[11px] text-primary hover:text-primary-hover transition-colors duration-150"
                >
                  Clear filter
                </button>
              </div>
            )}

            {/* CTAs */}
            <div className="mt-6 flex flex-col gap-2">
              {nextTier && (
                <p className="text-[12px] text-ink-subtle">
                  {nextTier.gap} more point{nextTier.gap !== 1 ? "s" : ""} to {nextTier.label}
                </p>
              )}
              {weakChapters.length > 0 && onPracticeWeak && (
                <button
                  type="button"
                  onClick={() => onPracticeWeak(weakChapters)}
                  className="inline-flex w-full items-center justify-center rounded-md border border-semantic-error/30 bg-semantic-error/5 px-6 py-2.5 text-sm font-medium text-semantic-error transition-colors duration-150 hover:bg-semantic-error/10"
                >
                  Practice weak areas ({weakChapters.length} chapter{weakChapters.length !== 1 ? "s" : ""})
                </button>
              )}
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex w-full items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover"
              >
                Try again
              </button>
            </div>
          </div>
          )}

          {/* ── Right Column: Question Review ── */}
          <div>
            <div className="flex items-baseline justify-between">
              <h3 className="text-body-sm font-semibold text-ink">
                Question Review
                {activeChapter && (
                  <span className="ml-2 text-[11px] font-normal text-ink-subtle">
                    {activeChapter.label} · {correctInFilter}/{totalInFilter} correct
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-ink-subtle">
                <span className="inline-block h-2 w-2 rounded-sm bg-semantic-success/30 align-middle" /> correct{" "}
                <span className="ml-1.5 inline-block h-2 w-2 rounded-sm bg-semantic-error/30 align-middle" /> incorrect
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {filteredAnswers.map((answer) => {
                const isSelected = selectedQuestion === answer.questionIndex;
                return (
                  <button
                    key={answer.questionIndex}
                    type="button"
                    aria-label={`Question ${answer.questionIndex + 1}, ${answer.isCorrect ? "correct" : "incorrect"}`}
                    onClick={() => setSelectedQuestion(isSelected ? null : answer.questionIndex)}
                    className={`flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-bold transition-all duration-150 ${
                      isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-canvas" : ""
                    } ${
                      answer.isCorrect
                        ? "bg-semantic-success/15 text-semantic-success hover:bg-semantic-success/25"
                        : "bg-semantic-error/15 text-semantic-error hover:bg-semantic-error/25"
                    }`}
                  >
                    {answer.questionIndex + 1}
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {selected && (
                <motion.div
                  key={selected.questionIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="mt-4 rounded-lg border border-hairline bg-surface-1 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] leading-relaxed text-ink">{selected.questionText}</p>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${selected.isCorrect ? "bg-semantic-success/15 text-semantic-success" : "bg-semantic-error/15 text-semantic-error"}`}>
                      {selected.isCorrect ? "Correct" : "Incorrect"}
                    </span>
                  </div>

                  <p className="mt-1 text-[10px] text-ink-subtle">{selected.dmbokChapterRef}</p>

                  <div className="mt-3 space-y-1">
                    {selected.options.map((opt) => {
                      const isUserAnswer = opt.code === selected.userAnswer;
                      const isCorrectAnswer = opt.code === selected.correctAnswer;
                      let style = "border-transparent bg-ink-subtle/5";
                      let badge = "";
                      if (isCorrectAnswer) {
                        style = "border-semantic-success/50 bg-semantic-success/10";
                        badge = isUserAnswer ? "Your answer (correct)" : "Correct answer";
                      } else if (isUserAnswer) {
                        style = "border-semantic-error/50 bg-semantic-error/10";
                        badge = "Your answer";
                      }
                      return (
                        <div key={opt.code} className={`flex items-start gap-2 rounded-md border px-3 py-1.5 ${style}`}>
                          <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${isCorrectAnswer ? "bg-semantic-success text-white" : isUserAnswer ? "bg-semantic-error text-white" : "bg-ink-subtle/20 text-ink-subtle"}`}>
                            {opt.code}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="text-[12px] leading-snug text-ink">{opt.label}</span>
                            {badge && <span className="ml-2 text-[10px] font-medium text-ink-subtle">{badge}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 border-t border-hairline pt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Explanation</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">{selected.explanation}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
