import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as comments from "@/lib/kanban/comments";

export const runtime = "nodejs";

// GET /api/projects/:id/cards/:cardId/comments — list a card's comments,
// oldest-first. Any member. 404 when the card is not in the caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { cardId } = await params;
    const list = await comments.listComments(ctx.orgId, cardId);
    return Response.json({ ok: true, comments: list });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/cards/:cardId/comments — add a comment. Any member.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    const body = await request.json().catch(() => null);
    const text = typeof body?.body === "string" ? body.body : "";
    if (text.trim().length === 0) {
      return Response.json(
        { ok: false, error: "Comment cannot be empty" },
        { status: 400 },
      );
    }

    const comment = await comments.createComment(
      ctx.orgId,
      cardId,
      auth.user.id,
      text,
    );
    if (!comment) {
      return Response.json(
        { ok: false, error: "Card not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, comment }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
