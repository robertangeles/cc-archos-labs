import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cdmpExamSession, cdmpExamAnswer } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";
import { scoreExam, type AnswerRecord } from "@/lib/cdmp/scoring";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  const db = getDb();

  const sessions = await db
    .select({
      id: cdmpExamSession.id,
      userId: cdmpExamSession.userId,
      status: cdmpExamSession.status,
    })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.id, body.sessionId))
    .limit(1);

  if (sessions.length === 0 || sessions[0].userId !== auth.session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (sessions[0].status !== "in_progress") {
    return NextResponse.json(
      { error: "Session is not in progress" },
      { status: 400 },
    );
  }

  const answers = await db
    .select({
      knowledgeArea: cdmpExamAnswer.knowledgeArea,
      isCorrect: cdmpExamAnswer.isCorrect,
    })
    .from(cdmpExamAnswer)
    .where(eq(cdmpExamAnswer.sessionId, body.sessionId));

  const answerRecords: AnswerRecord[] = answers.map((a) => ({
    knowledgeArea: a.knowledgeArea,
    isCorrect: a.isCorrect,
  }));

  const result = scoreExam(answerRecords);

  await db
    .update(cdmpExamSession)
    .set({
      status: "completed",
      correctCount: result.correctCount,
      scorePercent: result.percentCorrect,
      passed: result.thresholds.associate.passed,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(cdmpExamSession.id, body.sessionId));

  return NextResponse.json({ result });
}
