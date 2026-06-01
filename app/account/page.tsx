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
          <h2 className="text-lg font-semibold text-ink">CDMP Practice History</h2>
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
              {completed.map((exam) => (
                <li
                  key={exam.id}
                  className="flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3"
                >
                  <div>
                    <span className="text-sm font-medium text-ink">
                      {exam.questionCount}-question exam
                    </span>
                    <span className="ml-3 text-xs text-ink-subtle">
                      {exam.completedAt
                        ? new Date(exam.completedAt).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      (exam.scorePercent ?? 0) >= 60
                        ? "text-green-500"
                        : "text-red-500"
                    }`}
                  >
                    {exam.scorePercent ?? 0}%
                  </span>
                </li>
              ))}
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
