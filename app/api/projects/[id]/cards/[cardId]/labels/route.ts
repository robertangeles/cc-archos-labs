import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { assignLabelSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/cards/:cardId/labels — labels assigned to a card. Any
// member. Empty when the card is not in the caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { cardId } = await params;
    const labels = await kanbanService.getCardLabels(ctx.orgId, cardId);
    return Response.json({ ok: true, labels });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/cards/:cardId/labels — assign a label to a card. Any
// member. Idempotent on (card, label).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = assignLabelSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const ok = await kanbanService.assignLabel(
      ctx.orgId,
      cardId,
      parsed.data.labelId,
    );
    if (!ok) {
      // Card not in org, or the label does not belong to the card's project.
      return Response.json(
        { ok: false, error: "Card or label not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
