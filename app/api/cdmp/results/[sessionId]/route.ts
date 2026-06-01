import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cdmpExamSession, cdmpExamAnswer } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";
import { scoreExam, type AnswerRecord } from "@/lib/cdmp/scoring";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { sessionId } = await params;
  const db = getDb();

  const sessions = await db
    .select({
      id: cdmpExamSession.id,
      userId: cdmpExamSession.userId,
      status: cdmpExamSession.status,
      config: cdmpExamSession.config,
      questionCount: cdmpExamSession.questionCount,
      startedAt: cdmpExamSession.startedAt,
      completedAt: cdmpExamSession.completedAt,
    })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.id, sessionId))
    .limit(1);

  if (sessions.length === 0 || sessions[0].userId !== auth.session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const answers = await db
    .select({
      questionIndex: cdmpExamAnswer.questionIndex,
      questionText: cdmpExamAnswer.questionText,
      options: cdmpExamAnswer.options,
      userAnswer: cdmpExamAnswer.userAnswer,
      correctAnswer: cdmpExamAnswer.correctAnswer,
      isCorrect: cdmpExamAnswer.isCorrect,
      knowledgeArea: cdmpExamAnswer.knowledgeArea,
      explanation: cdmpExamAnswer.explanation,
      dmbokChapterRef: cdmpExamAnswer.dmbokChapterRef,
    })
    .from(cdmpExamAnswer)
    .where(eq(cdmpExamAnswer.sessionId, sessionId))
    .orderBy(cdmpExamAnswer.questionIndex);

  const answerRecords: AnswerRecord[] = answers.map((a) => ({
    knowledgeArea: a.knowledgeArea,
    isCorrect: a.isCorrect,
  }));

  const result = scoreExam(answerRecords);

  return NextResponse.json({
    session: sessions[0],
    result,
    answers,
  });
}
