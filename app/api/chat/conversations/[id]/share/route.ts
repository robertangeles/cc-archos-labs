import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as chatService from "@/lib/chat/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const share = await chatService.createShareSnapshot(id, auth.user.id);

  if (!share) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  const shareUrl = `/share/chat/${share.token}`;
  return NextResponse.json({ share, url: shareUrl }, { status: 201 });
}
