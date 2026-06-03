import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { cdmpExamSession } from "@/lib/db/schema";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Your Account",
    description: "Manage your Archos Labs account and review your activity.",
    path: "/account",
  });
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

export default async function AccountPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account");
  }

  const db = getDb();
  const exams = await db
    .select({
      id: cdmpExamSession.id,
      status: cdmpExamSession.status,
      questionCount: cdmpExamSession.questionCount,
      scorePercent: cdmpExamSession.scorePercent,
      startedAt: cdmpExamSession.startedAt,
      completedAt: cdmpExamSession.completedAt,
      createdAt: cdmpExamSession.createdAt,
    })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.userId, auth.user.id))
    .orderBy(desc(cdmpExamSession.createdAt))
    .limit(20);

  const completed = exams.filter((e) => e.status === "completed");

  return (
    <main className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto w-full max-w-[720px]">
        <p className="uppercase text-eyebrow text-ink-subtle">Your Account</p>
        <h1 className="mt-4 text-3xl font-semibold text-ink md:text-4xl">
          {auth.user.displayName || auth.user.email}
        </h1>
        <p className="mt-2 text-sm text-ink-subtle">{auth.user.email}</p>

        {!auth.user.emailVerifiedAt && (
          <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-5 py-3">
            <p className="text-sm font-medium text-yellow-300">
              Email not verified
            </p>
            <p className="mt-1 text-xs text-yellow-300/70">
              Check your inbox for a verification link. You need to verify
              your email before using Archos Labs tools.
            </p>
          </div>
        )}

        <div className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-ink">CDMP Practice History</h2>
            {completed.length > 0 && (
              <span className="text-[11px] text-ink-tertiary">Last 20 sessions kept</span>
            )}
          </div>
          {completed.length === 0 ? (
            <p className="mt-3 text-sm text-ink-subtle">
              No completed practice exams yet.{" "}
              <Link
                href="/tools/cdmp-practice"
                className="text-primary hover:text-primary-hover"
              >
                Start practicing
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {completed.map((exam, idx) => {
                const prevExam = completed[idx + 1];
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
                            score >= 60
                              ? "text-semantic-success"
                              : "text-semantic-error"
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
          )}
        </div>

        <div className="mt-10 border-t border-hairline pt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
