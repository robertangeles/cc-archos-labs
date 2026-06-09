import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as chatService from "@/lib/chat/service";
import { rateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { generateImage, ImageGenError, type AspectRatio, type ImageSize } from "@/lib/image-gen/service";

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const limitResult = rateLimit(
    `image-gen:${clientIpFromRequest(request)}`,
    100,
  );
  if (!limitResult.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  let body: { prompt?: string; conversationId?: string; aspectRatio?: string; imageSize?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const conversationId = body.conversationId;

  if (!prompt) {
    return NextResponse.json(
      { error: "Prompt is required" },
      { status: 400 },
    );
  }

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json(
      { error: "conversationId is required" },
      { status: 400 },
    );
  }

  const convo = await chatService.getConversation(
    conversationId,
    auth.user.id,
  );
  if (!convo) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  try {
    await chatService.saveMessage(conversationId, "user", prompt);
  } catch {
    // non-blocking: continue even if user message save fails
  }

  try {
    const result = await generateImage(prompt, {
      aspectRatio: (body.aspectRatio as AspectRatio) || undefined,
      imageSize: (body.imageSize as ImageSize) || undefined,
    });

    try {
      const summary =
        prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt;
      await chatService.saveMessage(
        conversationId,
        "assistant",
        `[Image generated: ${summary}]`,
        result.model,
      );
    } catch {
      // non-blocking: image still returned even if placeholder save fails
    }

    return NextResponse.json({
      imageUrl: result.imageUrl,
      text: result.text,
      model: result.model,
    });
  } catch (err) {
    if (err instanceof ImageGenError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Image generation failed" },
      { status: 502 },
    );
  }
}
