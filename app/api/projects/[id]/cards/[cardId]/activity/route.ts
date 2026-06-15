import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";

export const runtime = "nodejs";

// GET /api/projects/:id/cards/:cardId/activity — a card's history, newest
// first. Any member. Empty when the card is not in the caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { cardId } = await params;
    const activity = await kanbanService.listCardActivity(ctx.orgId, cardId);
    return Response.json({ ok: true, activity });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
