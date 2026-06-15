import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";

export const runtime = "nodejs";

// DELETE /api/projects/:id/cards/:cardId/labels/:labelId — remove a label from
// a card. Any member. 404 when no assignment was removed (not in org / absent).
export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; cardId: string; labelId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId, labelId } = await params;

    const removed = await kanbanService.unassignLabel(
      ctx.orgId,
      cardId,
      labelId,
    );
    if (!removed) {
      return Response.json(
        { ok: false, error: "Label assignment not found" },
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
