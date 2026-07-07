import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as attachments from "@/lib/chat/attachments/service";
import { attachmentErrorResponse } from "@/lib/chat/attachments/http";
import { MAX_UPLOAD_BYTES } from "@/lib/chat/attachments/extract";

export const runtime = "nodejs";

// POST /api/chat/conversations/:id/attachments — upload a document (multipart,
// field "file") to the conversation. GET — list the conversation's documents.
// Both owner-scoped (getCurrentUser + the service's ownership check).

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }
  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected a multipart file upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "No file provided." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: "File too large (max 50MB)." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await attachments.uploadAttachment({
      userId: auth.user.id,
      conversationId: id,
      buffer,
      fileName: file.name || "upload",
      fileType: file.type || "application/octet-stream",
    });
    if (!result.ok) {
      // Extraction rejected (scanned / unsupported / unreadable).
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return attachmentErrorResponse(err);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }
  const { id } = await params;
  try {
    const list = await attachments.listAttachments(auth.user.id, id);
    return NextResponse.json({ ok: true, attachments: list });
  } catch (err) {
    return attachmentErrorResponse(err);
  }
}
