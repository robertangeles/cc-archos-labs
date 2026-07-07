import { NextResponse } from "next/server";
import {
  ConversationNotFoundError,
  DocumentNotFoundError,
  TooManyAttachmentsError,
  FileTooLargeError,
} from "./service";
import { R2ChatNotConfiguredError } from "../../r2-chat-documents";

// Maps attachment service errors to consistent HTTP responses. Keeps HTTP
// concerns out of the service and the mapping DRY across the routes.
export function attachmentErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof ConversationNotFoundError ||
    err instanceof DocumentNotFoundError
  ) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (err instanceof TooManyAttachmentsError) {
    return NextResponse.json(
      {
        ok: false,
        error: "You can attach up to 5 documents per conversation.",
      },
      { status: 409 },
    );
  }
  if (err instanceof FileTooLargeError) {
    return NextResponse.json(
      { ok: false, error: "File too large (max 50MB)." },
      { status: 413 },
    );
  }
  if (err instanceof R2ChatNotConfiguredError) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "File storage isn't configured. Add Cloudflare R2 under Admin → Integrations → Chat Documents.",
      },
      { status: 503 },
    );
  }
  console.error("[attachments route] unexpected error:", err);
  return NextResponse.json(
    { ok: false, error: "An unexpected error occurred." },
    { status: 500 },
  );
}
