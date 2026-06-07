import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { cdmpExamSession, assessmentSession } from "@/lib/db/schema";
import { HistoryTabs } from "../history-tabs";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "History",
    description: "Your assessment and exam history on Archos Labs.",
    path: "/account/history",
  });
}

export default async function HistoryPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/history");
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

  return <HistoryTabs cdmpExams={completed} assessments={assessments} />;
}
