import "server-only";

// F3: structured, content-free telemetry for the attachment paths. NEVER logs
// file content, extracted text, or file names (a name like "Acme_MSA.pdf" is
// itself sensitive). Only mime type, sizes, status, and ids. A log pipeline can
// count these by `tag`/`event` for the day-1 dashboards (uploads, extraction
// failures by reason, storage errors, budget omissions).

export interface AttachmentEvent {
  event:
    | "upload_ready"
    | "upload_rejected"
    | "extract_failed"
    | "storage_error"
    | "budget_omitted"
    | "detach";
  userId?: string;
  conversationId?: string;
  documentId?: string;
  fileType?: string;
  byteSize?: number;
  charCount?: number;
  errorReason?: string | null;
  omittedCount?: number;
}

export function logAttachmentEvent(e: AttachmentEvent): void {
  console.log(JSON.stringify({ tag: "chat_attachment", ...e }));
}
