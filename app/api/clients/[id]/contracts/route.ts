import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { contractSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// GET /api/clients/[id]/contracts — list a client's contracts. Any member.
// 404 when the client is not in the caller's org (see contacts route note).
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
    const contracts = await clientService.listContracts(ctx.orgId, id);
    return Response.json({ ok: true, contracts });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// POST /api/clients/[id]/contracts — add a contract. Owner or admin only.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;
    const body = await request.json();
    const parsed = contractSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const created = await clientService.createContract(ctx.orgId, id, parsed.data);
    if (!created) {
      return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
    }
    return Response.json({ ok: true, contract: created }, { status: 201 });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
