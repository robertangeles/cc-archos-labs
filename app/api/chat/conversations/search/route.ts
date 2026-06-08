import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as chatService from "@/lib/chat/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const results = await chatService.searchConversations(auth.user.id, query);
  return NextResponse.json({ results });
}
