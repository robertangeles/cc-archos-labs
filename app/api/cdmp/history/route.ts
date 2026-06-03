import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cdmpExamSession } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const db = getDb();

  const sessions = await db
    .select({
      id: cdmpExamSession.id,
      config: cdmpExamSession.config,
      status: cdmpExamSession.status,
      questionCount: cdmpExamSession.questionCount,
      correctCount: cdmpExamSession.correctCount,
      scorePercent: cdmpExamSession.scorePercent,
      passed: cdmpExamSession.passed,
      startedAt: cdmpExamSession.startedAt,
      completedAt: cdmpExamSession.completedAt,
    })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.userId, auth.session.user.id))
    .orderBy(desc(cdmpExamSession.createdAt))
    .limit(50);

  return NextResponse.json({ sessions });
}
