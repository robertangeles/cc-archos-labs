import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { createClientSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// GET /api/clients — list the org's clients. Any member may read.
export async function GET(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request);
    const clients = await clientService.listClients(ctx.orgId);
    return Response.json({ ok: true, clients });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// POST /api/clients — create a client. Owner or admin only.
export async function POST(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const body = await request.json();
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const created = await clientService.createClient(ctx.orgId, parsed.data);
    return Response.json({ ok: true, client: created }, { status: 201 });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
