import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { moveCardSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// PATCH /api/projects/:id/cards/:cardId/move — move a card to a column + sort
// position. Any member. Rejects targets outside the card's own project/org.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = moveCardSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const card = await kanbanService.moveCard(
      ctx.orgId,
      cardId,
      parsed.data.toColumnId,
      parsed.data.toSortOrder,
    );
    if (!card) {
      // Card not in org, or target column not in the card's project.
      return Response.json(
        { ok: false, error: "Card or target column not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, card });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
