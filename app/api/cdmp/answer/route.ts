import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cdmpExamSession, cdmpExamAnswer } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";

const VALID_ANSWERS = ["A", "B", "C", "D", "E"];

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: {
    sessionId?: string;
    questionIndex?: number;
    questionText?: string;
    options?: Array<{ code: string; label: string }>;
    userAnswer?: string;
    correctAnswer?: string;
    knowledgeArea?: string;
    explanation?: string;
    dmbokChapterRef?: string;
    chunkIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sessionId || body.questionIndex === undefined || !body.userAnswer) {
    return NextResponse.json(
      { error: "sessionId, questionIndex, and userAnswer are required" },
      { status: 400 },
    );
  }

  if (!VALID_ANSWERS.includes(body.userAnswer)) {
    return NextResponse.json(
      { error: "userAnswer must be A, B, C, D, or E" },
      { status: 400 },
    );
  }

  const db = getDb();

  const sessions = await db
    .select({ id: cdmpExamSession.id, userId: cdmpExamSession.userId, status: cdmpExamSession.status })
    .from(cdmpExamSession)
    .where(eq(cdmpExamSession.id, body.sessionId))
    .limit(1);

  if (sessions.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (sessions[0].userId !== auth.session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (sessions[0].status !== "in_progress") {
    return NextResponse.json(
      { error: "Session is not in progress" },
      { status: 400 },
    );
  }

  const isCorrect = body.userAnswer === body.correctAnswer;

  await db.insert(cdmpExamAnswer).values({
    sessionId: body.sessionId,
    questionIndex: body.questionIndex,
    questionText: body.questionText ?? "",
    options: body.options ?? [],
    userAnswer: body.userAnswer,
    correctAnswer: body.correctAnswer ?? "",
    isCorrect,
    knowledgeArea: body.knowledgeArea ?? "",
    explanation: body.explanation ?? "",
    dmbokChapterRef: body.dmbokChapterRef ?? "",
    chunkIds: body.chunkIds ?? [],
  });

  return NextResponse.json({ isCorrect });
}
