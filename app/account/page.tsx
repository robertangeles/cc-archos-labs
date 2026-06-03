import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { cdmpExamSession, assessmentSession, users } from "@/lib/db/schema";
import { SignOutButton } from "./sign-out-button";
import { HistoryTabs } from "./history-tabs";
import { ProfileEdit } from "./profile-edit";

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
      startedAt: cdmpExamSession.startedAt,
      completedAt: cdmpExamSession.completedAt,
      createdAt: cdmpExamSession.createdAt,
    })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.userId, auth.user.id))
    .orderBy(desc(cdmpExamSession.createdAt))
    .limit(20);

  const completed = exams.filter((e) => e.status === "completed");

  const [userRow] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  const hasPassword = !!userRow?.passwordHash;

  const assessments = await db
    .select({
      id: assessmentSession.id,
      tier: assessmentSession.tier,
      scores: assessmentSession.scores,
      completedAt: assessmentSession.completedAt,
      createdAt: assessmentSession.createdAt,
    })
    .from(assessmentSession)
    .where(
      and(
        eq(assessmentSession.userId, auth.user.id),
        eq(assessmentSession.status, "completed"),
      ),
    )
    .orderBy(desc(assessmentSession.completedAt))
    .limit(10);

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

        <div className="mt-10 rounded-lg border border-hairline bg-surface-1 p-6">
          <h2 className="text-body-sm font-semibold text-ink">Profile</h2>
          <div className="mt-4">
            <ProfileEdit
              displayName={auth.user.displayName || ""}
              email={auth.user.email}
              hasPassword={hasPassword}
            />
          </div>
        </div>

        <div className="mt-10">
          <HistoryTabs cdmpExams={completed} assessments={assessments} />
        </div>

        <div className="mt-10 border-t border-hairline pt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
