import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { updateContactSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// PATCH /api/clients/[id]/contacts/[contactId] — update a contact. Owner|admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, contactId } = await params;
    const body = await request.json();
    const parsed = updateContactSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const updated = await clientService.updateContact(
      ctx.orgId,
      id,
      contactId,
      parsed.data,
    );
    if (!updated) {
      return Response.json({ ok: false, error: "Contact not found" }, { status: 404 });
    }
    return Response.json({ ok: true, contact: updated });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// DELETE /api/clients/[id]/contacts/[contactId] — remove a contact. Owner|admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, contactId } = await params;
    const deleted = await clientService.deleteContact(ctx.orgId, id, contactId);
    if (!deleted) {
      return Response.json({ ok: false, error: "Contact not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
