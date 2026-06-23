import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth-server";
import { ingestDocument, IngestError } from "@/lib/knowledge/ingest";

// Text-only ingestion via JSON. For PDFs larger than ~10MB, use the CLI:
//   pnpm ingest:pdf /path/to/file.pdf "Title" category
// Next.js App Router enforces a ~10MB body limit that cannot be overridden.

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { title?: string; category?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.title || !body.text) {
    return NextResponse.json(
      { error: "title and text are required" },
      { status: 400 },
    );
  }

  if (body.text.length > 5_000_000) {
    return NextResponse.json(
      { error: "Text must be under 5MB. For large PDFs use: pnpm ingest:pdf" },
      { status: 400 },
    );
  }

  try {
    const documentId = await ingestDocument(
      body.title,
      "text",
      body.category ?? "dmbok",
      body.text,
    );
    return NextResponse.json({ ok: true, documentId });
  } catch (err) {
    if (err instanceof IngestError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // Log the raw error for diagnosis; send a generic message to the client.
    // (The IngestError branch above is a typed, user-safe message.)
    console.error("[POST /api/admin/knowledge/upload]", err);
    return NextResponse.json(
      { error: "Ingestion failed" },
      { status: 500 },
    );
  }
}
