import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as attachments from "@/lib/kanban-attachments/service";

export const runtime = "nodejs";

// DELETE /api/projects/:id/cards/:cardId/attachments/:attachmentId — remove an
// attachment. Any member (v1). 404 when the attachment is not in the caller's
// org, so cross-org ids leak nothing.
export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; cardId: string; attachmentId: string }>;
  },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { attachmentId } = await params;

    const removed = await attachments.deleteAttachment(ctx.orgId, attachmentId);
    if (!removed) {
      return Response.json(
        { ok: false, error: "Attachment not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
