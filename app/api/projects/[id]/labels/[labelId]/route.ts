import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";

export const runtime = "nodejs";

// DELETE /api/projects/:id/labels/:labelId — delete a label. Owner/admin only.
// The label's assignments cascade away with it.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; labelId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, labelId } = await params;

    const removed = await kanbanService.deleteLabel(ctx.orgId, id, labelId);
    if (!removed) {
      return Response.json(
        { ok: false, error: "Label not found" },
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
