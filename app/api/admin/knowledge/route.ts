import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth-server";
import { listDocuments, deleteDocument } from "@/lib/knowledge/ingest";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (err) {
    console.error("[GET /api/admin/knowledge] listDocuments failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list documents" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("id");
  if (!documentId) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 },
    );
  }

  try {
    await deleteDocument(documentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/admin/knowledge] deleteDocument failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete document" },
      { status: 500 },
    );
  }
}
