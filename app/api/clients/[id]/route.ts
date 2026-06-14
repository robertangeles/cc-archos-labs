import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { updateClientSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// GET /api/clients/[id] — fetch one client. Any member. 404 if not in org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { id } = await params;
    const found = await clientService.getClient(ctx.orgId, id);
    if (!found) {
      return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
    }
    return Response.json({ ok: true, client: found });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// PATCH /api/clients/[id] — update a client. Owner or admin only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;
    const body = await request.json();
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const updated = await clientService.updateClient(ctx.orgId, id, parsed.data);
    if (!updated) {
      return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
    }
    return Response.json({ ok: true, client: updated });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// DELETE /api/clients/[id] — delete a client. Owner or admin only.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;
    const deleted = await clientService.deleteClient(ctx.orgId, id);
    if (!deleted) {
      return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
