import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as comments from "@/lib/kanban/comments";

export const runtime = "nodejs";

// DELETE /api/projects/:id/cards/:cardId/comments/:commentId — delete a
// comment. Allowed for the comment's author OR an org owner/admin. 404 when the
// comment is not in the caller's org or the caller may not remove it.
export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; cardId: string; commentId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const { commentId } = await params;

    const removed = await comments.deleteComment(
      ctx.orgId,
      commentId,
      auth.user.id,
      ctx.role,
    );
    if (!removed) {
      return Response.json(
        { ok: false, error: "Comment not found" },
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
