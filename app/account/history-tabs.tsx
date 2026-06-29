"use client";

import { useState } from "react";
import Link from "next/link";

interface CdmpExam {
  id: string;
  questionCount: number;
  scorePercent: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  examType: "fundamentals" | "specialist";
  specialistLabel: string | null;
}

interface Assessment {
  id: string;
  tier: string | null;
  scores: unknown;
  completedAt: Date | null;
  createdAt: Date;
}

function formatTime(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function durationMinutes(start: Date | null, end: Date | null): string {
  if (!start || !end) return "-";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  return `${mins} min`;
}

const TABS = [
  { key: "cdmp", label: "CDMP Practice" },
  { key: "readiness", label: "AI Readiness" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function HistoryTabs({
  cdmpExams,
  assessments,
}: {
  cdmpExams: CdmpExam[];
  assessments: Assessment[];
}) {
  const [tab, setTab] = useState<TabKey>("cdmp");

  return (
    <div>
      <div className="flex gap-1 border-b border-hairline">
        {TABS.map((t) => {
          const count = t.key === "cdmp" ? cdmpExams.length : assessments.length;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "text-ink"
                  : "text-ink-subtle hover:text-ink"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`ml-1.5 text-[11px] ${isActive ? "text-ink-subtle" : "text-ink-tertiary"}`}>
                  {count}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {tab === "cdmp" && <CdmpHistory exams={cdmpExams} />}
        {tab === "readiness" && <ReadinessHistory assessments={assessments} />}
      </div>
    </div>
  );
}

function CdmpHistory({ exams }: { exams: CdmpExam[] }) {
  if (exams.length === 0) {
    return (
      <p className="py-6 text-sm text-ink-subtle">
        No completed practice exams yet.{" "}
        <Link href="/tools/cdmp-practice" className="text-primary hover:text-primary-hover">
          Start practicing
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[11px] text-ink-tertiary">Last 20 sessions kept</p>
      </div>
      <ul className="space-y-2">
        {exams.map((exam, idx) => {
          const prevExam = exams[idx + 1];
          const score = exam.scorePercent ?? 0;
          const prevScore = prevExam?.scorePercent ?? null;
          const diff = prevScore !== null ? score - prevScore : null;

          return (
            <li key={exam.id}>
              <Link
                href={`/tools/cdmp-practice/history/${exam.id}`}
                className="flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-ink">
                      {exam.questionCount}-question exam
                    </span>
                    {exam.examType === "specialist" && exam.specialistLabel && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {exam.specialistLabel}
                      </span>
                    )}
                    <span className="text-xs text-ink-subtle">
                      {formatDate(exam.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
                    <span>
                      {formatTime(exam.startedAt)} - {formatTime(exam.completedAt)}
                    </span>
                    <span>
                      {durationMinutes(exam.startedAt, exam.completedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {diff !== null && diff !== 0 && (
                    <span
                      className={`text-[11px] font-medium ${
                        diff > 0 ? "text-semantic-success" : "text-semantic-error"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}{diff}%
                    </span>
                  )}
                  <span
                    className={`text-sm font-semibold ${
                      score >= 60 ? "text-semantic-success" : "text-semantic-error"
                    }`}
                  >
                    {score}%
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ReadinessHistory({ assessments }: { assessments: Assessment[] }) {
  if (assessments.length === 0) {
    return (
      <p className="py-6 text-sm text-ink-subtle">
        No completed assessments yet.{" "}
        <Link href="/tools/ai-readiness" className="text-primary hover:text-primary-hover">
          Take the assessment
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {assessments.map((a) => {
        const scores = a.scores as { total?: number } | null;
        return (
          <li key={a.id}>
            <Link
              href={`/tools/ai-readiness/report/${a.id}`}
              className="flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">
                  AI Readiness Assessment
                </span>
                <span className="text-xs text-ink-subtle">
                  {formatDate(a.completedAt ?? a.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {a.tier && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {a.tier}
                  </span>
                )}
                {scores?.total != null && (
                  <span className="text-sm font-semibold text-ink">
                    {scores.total}%
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
