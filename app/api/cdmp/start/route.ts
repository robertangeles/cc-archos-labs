import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cdmpExamSession } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";
import { getCdmpConfig } from "@/lib/cdmp/config";
import { distributeQuestions } from "@/lib/cdmp/weights";
import { generateQuestionBatch } from "@/lib/cdmp/generate";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const config = await getCdmpConfig();

  let body: { questionCount?: number; timerEnabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionCount = body.questionCount ?? 100;
  if (!config.questionCounts.includes(questionCount)) {
    return NextResponse.json(
      { error: `questionCount must be one of: ${config.questionCounts.join(", ")}` },
      { status: 400 },
    );
  }

  const timerEnabled = body.timerEnabled ?? true;
  const timerSeconds = timerEnabled
    ? Math.round((questionCount / 100) * config.timerMinutesPer100 * 60)
    : 0;

  const db = getDb();

  const [session] = await db
    .insert(cdmpExamSession)
    .values({
      userId: auth.session.user.id,
      config: { questionCount, timerEnabled, timerSeconds },
      status: "in_progress",
      questionCount,
    })
    .returning({ id: cdmpExamSession.id });

  const distribution = distributeQuestions(questionCount, config.knowledgeAreas);
  console.log(
    "[cdmp/start] distribution:",
    distribution.map((d) => `${d.slug}:${d.questionCount}`).join(", "),
  );

  const questions = await generateQuestionBatch(distribution);
  console.log(`[cdmp/start] generated ${questions.length} questions`);

  if (questions.length === 0) {
    console.error(
      "[cdmp/start] No questions generated. Check knowledge base and LLM config.",
    );
  }

  return NextResponse.json({
    sessionId: session.id,
    config: { questionCount, timerEnabled, timerSeconds },
    questions,
    totalQuestions: questionCount,
  });
}
