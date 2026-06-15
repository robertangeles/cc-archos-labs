import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { updateContractSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// PATCH /api/clients/[id]/contracts/[contractId] — update a contract. Owner|admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, contractId } = await params;
    const body = await request.json();
    const parsed = updateContractSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const updated = await clientService.updateContract(
      ctx.orgId,
      id,
      contractId,
      parsed.data,
    );
    if (!updated) {
      return Response.json({ ok: false, error: "Contract not found" }, { status: 404 });
    }
    return Response.json({ ok: true, contract: updated });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// DELETE /api/clients/[id]/contracts/[contractId] — remove a contract. Owner|admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, contractId } = await params;
    const deleted = await clientService.deleteContract(ctx.orgId, id, contractId);
    if (!deleted) {
      return Response.json({ ok: false, error: "Contract not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
