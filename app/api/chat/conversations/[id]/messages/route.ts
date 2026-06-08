import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { sendMessageSchema } from "@/lib/chat/validation";
import * as chatService from "@/lib/chat/service";
import { streamMessage, generateTitle, StreamError } from "@/lib/chat/stream";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { id } = await params;

  const convo = await chatService.getConversation(id, auth.user.id);
  if (!convo) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  const isFirstExchange = convo.messages.length === 0;

  try {
    const { stream, cleanup } = await streamMessage({
      conversationId: id,
      userId: auth.user.id,
      userContent: parsed.data.content,
      modelOverride: parsed.data.model,
      systemPrompt: convo.conversation.systemPrompt,
      signal: request.signal,
    });

    const transformedStream = stream.pipeThrough(
      new TransformStream({
        flush: async () => {
          await cleanup();
          if (isFirstExchange) {
            generateTitle(id, parsed.data.content, "").catch(() => {});
          }
        },
      }),
    );

    return new Response(transformedStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    if (err instanceof StreamError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
