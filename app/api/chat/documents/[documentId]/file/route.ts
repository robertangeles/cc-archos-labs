import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOwnedDocument } from "@/lib/chat/attachments/service";
import {
  r2ChatConfigFromIntegration,
  buildR2ChatClient,
  getChatDocument,
} from "@/lib/r2-chat-documents";

export const runtime = "nodejs";

// GET /api/chat/documents/:documentId/file — authz'd download/preview proxy.
// Streams the private R2 object ONLY to its owner. Never issues a public URL.
// Forwards Range so the browser's native PDF viewer can seek (OV #4), and sets
// Content-Type from the stored mime so PDFs render inline (OV #5).

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, "").slice(0, 200) || "document";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }
  const { documentId } = await params;

  const doc = await getOwnedDocument(auth.user.id, documentId);
  if (!doc || !doc.storageKey) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const storage = await r2ChatConfigFromIntegration();
  if (!storage) {
    return NextResponse.json(
      { ok: false, error: "File storage isn't configured." },
      { status: 503 },
    );
  }

  const range = request.headers.get("range") ?? undefined;
  try {
    const client = buildR2ChatClient(storage);
    const obj = await getChatDocument({
      config: storage,
      client,
      key: doc.storageKey,
      range,
    });

    const headers = new Headers();
    headers.set(
      "Content-Type",
      doc.fileType || obj.contentType || "application/octet-stream",
    );
    headers.set(
      "Content-Disposition",
      `inline; filename="${sanitizeFilename(doc.fileName)}"`,
    );
    // Confidential — no shared/browser caching.
    headers.set("Cache-Control", "private, no-store");
    headers.set("Accept-Ranges", "bytes");
    if (obj.contentLength != null) {
      headers.set("Content-Length", String(obj.contentLength));
    }

    let status = 200;
    if (range && obj.contentRange) {
      headers.set("Content-Range", obj.contentRange);
      status = 206;
    }

    return new Response(obj.body, { status, headers });
  } catch (err) {
    console.error("[chat/documents/file] fetch failed:", err);
    return NextResponse.json(
      { ok: false, error: "Couldn't load the document." },
      { status: 502 },
    );
  }
}
