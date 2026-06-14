import {
  requireOrgContext,
  orgAuthErrorResponse,
  type OrgRole,
} from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

// Resolve the requester's role IN THE [id] ORG from its membership rows.
// requireOrgContext only proves membership of the COOKIE org, so we re-check
// membership of the path org here and read the role from that org's members.
// Returns null when the user is not a member of the [id] org (caller → 404).
function roleInOrg(
  org: Awaited<ReturnType<typeof orgService.getOrgWithMembers>>,
  userId: string,
): OrgRole | null {
  if (!org) return null;
  const member = org.members.find((m) => m.userId === userId);
  return member ? (member.role as OrgRole) : null;
}

// GET /api/organisations/[id] — org detail + members. Any member of the org.
// joinKey is omitted unless the requester is owner|admin.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let auth;
  try {
    ({ auth } = await requireOrgContext(request));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const org = await orgService.getOrgWithMembers(id);
  const role = roleInOrg(org, auth.user.id);
  if (!org || !role) {
    return Response.json(
      { ok: false, error: "Organisation not found" },
      { status: 404 },
    );
  }

  // Strip the invite key from the response unless the requester can manage it.
  const canSeeKey = role === "owner" || role === "admin";
  const { joinKey, ...rest } = org;
  const organisation = canSeeKey ? { ...rest, joinKey } : rest;

  return Response.json({ ok: true, organisation });
}

// PATCH /api/organisations/[id] — update org details. owner|admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let auth;
  try {
    ({ auth } = await requireOrgContext(request, { mutation: true }));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const org = await orgService.getOrgWithMembers(id);
  const role = roleInOrg(org, auth.user.id);
  if (!org || !role) {
    return Response.json(
      { ok: false, error: "Organisation not found" },
      { status: 404 },
    );
  }
  if (role !== "owner" && role !== "admin") {
    return Response.json(
      { ok: false, error: "You do not have permission to update this organisation" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { name, description, logoUrl } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    logoUrl?: unknown;
  };

  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    return Response.json(
      { ok: false, error: "Organisation name cannot be empty" },
      { status: 400 },
    );
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return Response.json(
      { ok: false, error: "Description must be text" },
      { status: 400 },
    );
  }
  if (logoUrl !== undefined && logoUrl !== null && typeof logoUrl !== "string") {
    return Response.json(
      { ok: false, error: "Logo URL must be text" },
      { status: 400 },
    );
  }

  const updated = await orgService.updateOrg(id, {
    ...(name !== undefined ? { name: (name as string).trim() } : {}),
    ...(description !== undefined ? { description: description as string | null } : {}),
    ...(logoUrl !== undefined ? { logoUrl: logoUrl as string | null } : {}),
  });

  return Response.json({ ok: true, organisation: updated });
}

// DELETE /api/organisations/[id] — delete the org. owner only.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let auth;
  try {
    ({ auth } = await requireOrgContext(request, { mutation: true }));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const org = await orgService.getOrgWithMembers(id);
  const role = roleInOrg(org, auth.user.id);
  if (!org || !role) {
    return Response.json(
      { ok: false, error: "Organisation not found" },
      { status: 404 },
    );
  }
  if (role !== "owner") {
    return Response.json(
      { ok: false, error: "Only the owner can delete this organisation" },
      { status: 403 },
    );
  }

  await orgService.deleteOrg(id);

  return Response.json({ ok: true });
}
