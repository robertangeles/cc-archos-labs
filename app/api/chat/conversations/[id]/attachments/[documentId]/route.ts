import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { detachDocument } from "@/lib/chat/attachments/service";
import { attachmentErrorResponse } from "@/lib/chat/attachments/http";

export const runtime = "nodejs";

// DELETE /api/chat/conversations/:id/attachments/:documentId — detach a
// document from this conversation. In v1 (1:1) this also deletes the document
// row + its R2 object when the ref-count hits zero. Owner-scoped.

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }
  const { id, documentId } = await params;
  try {
    await detachDocument(auth.user.id, id, documentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return attachmentErrorResponse(err);
  }
}
