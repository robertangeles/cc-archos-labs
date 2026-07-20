import "server-only";

// Structured, content-free telemetry for the workspace_memory ingest path.
// NEVER logs the fact body or any entity text — only ids, source_type, the
// outcome, and a short error reason. A log pipeline counts these by
// `tag`/`event` for the ingest dashboards (ok vs failed by source_type, retry
// rate). This is what makes a silent fire-and-forget failure visible.

export interface WorkspaceIngestEvent {
  event:
    | "ingest_ok"
    | "ingest_retry"
    | "ingest_failed"
    | "deactivate_ok"
    | "deactivate_failed";
  orgId?: string;
  sourceType?: string;
  sourceEntityId?: string;
  reason?: string; // error text (embed/DB failure), never entity content
}

export function logWorkspaceIngestEvent(e: WorkspaceIngestEvent): void {
  console.log(JSON.stringify({ tag: "workspace_ingest", ...e }));
}

// A short, content-free reason from a thrown value. Ingest failures are
// embed-API / DB errors (timeouts, connection, HTTP) — not the fact body — but
// we cap length defensively.
export function safeReason(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : "unknown";
}
