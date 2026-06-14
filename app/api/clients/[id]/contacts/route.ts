import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as clientService from "@/lib/clients/service";
import { contactSchema } from "@/lib/clients/validation";

export const runtime = "nodejs";

// GET /api/clients/[id]/contacts — list a client's contacts. Any member.
// Returns 404 when the client is not in the caller's org (listContacts is
// org-scoped through the parent, so a foreign client yields an empty list and
// we must distinguish "no contacts" from "not your client").
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
    const contacts = await clientService.listContacts(ctx.orgId, id);
    return Response.json({ ok: true, contacts });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// POST /api/clients/[id]/contacts — add a contact. Owner or admin only.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;
    const body = await request.json();
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const created = await clientService.createContact(ctx.orgId, id, parsed.data);
    if (!created) {
      return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
    }
    return Response.json({ ok: true, contact: created }, { status: 201 });
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
