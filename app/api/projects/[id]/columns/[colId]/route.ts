import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { updateColumnSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// PATCH /api/projects/:id/columns/:colId — update a column. Any member.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; colId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { id, colId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateColumnSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const column = await kanbanService.updateColumn(
      ctx.orgId,
      id,
      colId,
      parsed.data,
    );
    if (!column) {
      return Response.json({ ok: false, error: "Column not found" }, { status: 404 });
    }
    return Response.json({ ok: true, column });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// DELETE /api/projects/:id/columns/:colId — delete a column. Any member.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; colId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { id, colId } = await params;

    const removed = await kanbanService.deleteColumn(ctx.orgId, id, colId);
    if (!removed) {
      return Response.json({ ok: false, error: "Column not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
