import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createConversationSchema } from "@/lib/chat/validation";
import * as chatService from "@/lib/chat/service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const conversations = await chatService.listConversations(auth.user.id);
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const conversation = await chatService.createConversation(
    auth.user.id,
    parsed.data.model,
    parsed.data.title,
    parsed.data.systemPrompt,
  );

  return NextResponse.json({ conversation }, { status: 201 });
}
