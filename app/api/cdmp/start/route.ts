import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cdmpExamSession } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";
import { getCdmpConfig } from "@/lib/cdmp/config";
import { distributeQuestions } from "@/lib/cdmp/weights";
import {
  generateQuestionBatch,
  generateSpecialistExam,
} from "@/lib/cdmp/generate";
import { isSpecialistAreaSlug } from "@/lib/cdmp/config-shared";
import { getSpecialistArea } from "@/lib/cdmp/specialist";

// If generation delivers fewer than this fraction of the requested questions,
// treat it as a real failure and return an error rather than a broken exam.
const MIN_QUESTION_RATIO = 0.5;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const config = await getCdmpConfig();

  let body: {
    mode?: string;
    specialistArea?: string;
    questionCount?: number;
    timerEnabled?: boolean;
    weakChapters?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const timerEnabled = body.timerEnabled ?? true;
  const userId = auth.session.user.id;
  const db = getDb();

  // ========================================================================
  // Specialist exam — one DMBOK chapter
  // ========================================================================
  if (body.mode === "specialist") {
    const area = body.specialistArea;
    if (!area || !isSpecialistAreaSlug(area)) {
      return NextResponse.json(
        { error: "Invalid specialist area" },
        { status: 400 },
      );
    }

    const info = await getSpecialistArea(area);
    if (!info || info.poolSize === 0) {
      return NextResponse.json(
        { error: "This subject isn't ready yet. Please try another." },
        { status: 503 },
      );
    }

    const questionCount = body.questionCount ?? Math.min(40, info.maxQuestions);
    if (!config.questionCounts.includes(questionCount)) {
      return NextResponse.json(
        { error: `questionCount must be one of: ${config.questionCounts.join(", ")}` },
        { status: 400 },
      );
    }
    if (questionCount > info.maxQuestions) {
      return NextResponse.json(
        {
          error: `${info.label} supports up to ${info.maxQuestions} questions right now. Choose a smaller count.`,
          maxQuestions: info.maxQuestions,
        },
        { status: 400 },
      );
    }

    // Generate BEFORE inserting the session, so a generation failure never
    // leaves an orphan in_progress row.
    const questions = await generateSpecialistExam(area, questionCount);
    if (questions.length < Math.ceil(questionCount * MIN_QUESTION_RATIO)) {
      console.error(
        `[cdmp/start] specialist "${area}" underdelivered: ${questions.length}/${questionCount}`,
      );
      return NextResponse.json(
        {
          error:
            "We couldn't build a full set for this subject right now. Try a smaller count or another subject.",
        },
        { status: 502 },
      );
    }

    const timerSeconds = timerEnabled
      ? Math.round((questionCount / 100) * config.timerMinutesPer100 * 60)
      : 0;
    const sessionConfig = {
      questionCount,
      timerEnabled,
      timerSeconds,
      mode: "specialist" as const,
      specialistArea: area,
    };
    const [session] = await db
      .insert(cdmpExamSession)
      .values({
        userId,
        config: sessionConfig,
        status: "in_progress",
        questionCount: questions.length,
        examType: "specialist",
        specialistArea: area,
      })
      .returning({ id: cdmpExamSession.id });

    return NextResponse.json({
      sessionId: session.id,
      config: sessionConfig,
      questions,
      totalQuestions: questions.length,
    });
  }

  // ========================================================================
  // Fundamentals exam — all 14 areas, weighted (unchanged)
  // ========================================================================
  const questionCount = body.questionCount ?? 100;
  if (!config.questionCounts.includes(questionCount)) {
    return NextResponse.json(
      { error: `questionCount must be one of: ${config.questionCounts.join(", ")}` },
      { status: 400 },
    );
  }

  const timerSeconds = timerEnabled
    ? Math.round((questionCount / 100) * config.timerMinutesPer100 * 60)
    : 0;

  const [session] = await db
    .insert(cdmpExamSession)
    .values({
      userId,
      config: { questionCount, timerEnabled, timerSeconds },
      status: "in_progress",
      questionCount,
    })
    .returning({ id: cdmpExamSession.id });

  const validSlugs = new Set(config.knowledgeAreas.map((a) => a.slug));
  const weakChapters = body.weakChapters;
  if (weakChapters) {
    if (!Array.isArray(weakChapters) || weakChapters.length > 14 || weakChapters.some((s) => typeof s !== "string" || !validSlugs.has(s))) {
      return NextResponse.json(
        { error: "weakChapters must be an array of valid knowledge area slugs" },
        { status: 400 },
      );
    }
  }

  const distribution = distributeQuestions(questionCount, config.knowledgeAreas, weakChapters);
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
