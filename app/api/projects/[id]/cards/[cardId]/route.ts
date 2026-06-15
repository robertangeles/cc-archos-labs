import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { updateCardSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/cards/:cardId — fetch one card. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { cardId } = await params;
    const card = await kanbanService.getCard(ctx.orgId, cardId);
    if (!card) {
      return Response.json({ ok: false, error: "Card not found" }, { status: 404 });
    }
    return Response.json({ ok: true, card });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// PATCH /api/projects/:id/cards/:cardId — update a card. Any member.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateCardSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const card = await kanbanService.updateCard(
      ctx.orgId,
      cardId,
      parsed.data,
      auth.user.id,
    );
    if (!card) {
      return Response.json({ ok: false, error: "Card not found" }, { status: 404 });
    }
    return Response.json({ ok: true, card });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// DELETE /api/projects/:id/cards/:cardId — delete a card. Any member.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    const removed = await kanbanService.deleteCard(
      ctx.orgId,
      cardId,
      auth.user.id,
    );
    if (!removed) {
      return Response.json({ ok: false, error: "Card not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
