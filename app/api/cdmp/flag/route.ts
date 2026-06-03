import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cdmpQuestionFlag } from "@/lib/db/schema";
import { requireUser } from "@/lib/cdmp/auth";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { answerId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.answerId || !body.reason) {
    return NextResponse.json(
      { error: "answerId and reason are required" },
      { status: 400 },
    );
  }

  if (body.reason.length > 1000) {
    return NextResponse.json(
      { error: "reason must be 1000 characters or less" },
      { status: 400 },
    );
  }

  const db = getDb();

  await db.insert(cdmpQuestionFlag).values({
    answerId: body.answerId,
    userId: auth.session.user.id,
    reason: body.reason,
  });

  return NextResponse.json({ ok: true });
}
