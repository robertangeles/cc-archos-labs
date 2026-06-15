import {
  requireOrgContext,
  orgAuthErrorResponse,
  type OrgRole,
} from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

const VALID_ROLES: OrgRole[] = ["owner", "admin", "member"];

// Read the requester's role in the [id] org from its membership rows (the
// cookie org may differ). Returns null when they are not a member → 404.
function roleInOrg(
  org: Awaited<ReturnType<typeof orgService.getOrgWithMembers>>,
  userId: string,
): OrgRole | null {
  if (!org) return null;
  const member = org.members.find((m) => m.userId === userId);
  return member ? (member.role as OrgRole) : null;
}

// PATCH /api/organisations/[id]/members/[memberId] — change a member's role.
// owner|admin. Only an owner may set or clear the owner role. The last owner
// can never be demoted.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;

  let auth;
  try {
    ({ auth } = await requireOrgContext(request, { mutation: true }));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const org = await orgService.getOrgWithMembers(id);
  const requesterRole = roleInOrg(org, auth.user.id);
  if (!org || !requesterRole) {
    return Response.json(
      { ok: false, error: "Organisation not found" },
      { status: 404 },
    );
  }
  if (requesterRole !== "owner" && requesterRole !== "admin") {
    return Response.json(
      { ok: false, error: "You do not have permission to manage members" },
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

  const { role } = (body ?? {}) as { role?: unknown };
  if (typeof role !== "string" || !VALID_ROLES.includes(role as OrgRole)) {
    return Response.json(
      { ok: false, error: "A valid role is required" },
      { status: 400 },
    );
  }
  const newRole = role as OrgRole;

  const target = org.members.find((m) => m.id === memberId);
  if (!target) {
    return Response.json(
      { ok: false, error: "Member not found" },
      { status: 404 },
    );
  }
  const targetRole = target.role as OrgRole;

  // Only an owner may set or clear the owner role.
  const settingOwner = newRole === "owner";
  const clearingOwner = targetRole === "owner" && newRole !== "owner";
  if ((settingOwner || clearingOwner) && requesterRole !== "owner") {
    return Response.json(
      { ok: false, error: "Only the owner can change owner roles" },
      { status: 403 },
    );
  }

  // Never demote the last owner.
  if (clearingOwner) {
    const owners = await orgService.countOwners(id);
    if (owners <= 1) {
      return Response.json(
        { ok: false, error: "An org must have at least one owner" },
        { status: 400 },
      );
    }
  }

  const updated = await orgService.updateMemberRole(id, memberId, newRole);
  if (!updated) {
    return Response.json(
      { ok: false, error: "Member not found" },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}

// DELETE /api/organisations/[id]/members/[memberId] — remove a member.
// owner|admin. Only an owner may remove an owner. The last owner can never
// be removed.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;

  let auth;
  try {
    ({ auth } = await requireOrgContext(request, { mutation: true }));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const org = await orgService.getOrgWithMembers(id);
  const requesterRole = roleInOrg(org, auth.user.id);
  if (!org || !requesterRole) {
    return Response.json(
      { ok: false, error: "Organisation not found" },
      { status: 404 },
    );
  }
  if (requesterRole !== "owner" && requesterRole !== "admin") {
    return Response.json(
      { ok: false, error: "You do not have permission to manage members" },
      { status: 403 },
    );
  }

  const target = org.members.find((m) => m.id === memberId);
  if (!target) {
    return Response.json(
      { ok: false, error: "Member not found" },
      { status: 404 },
    );
  }
  const targetRole = target.role as OrgRole;

  // Only an owner may remove an owner.
  if (targetRole === "owner" && requesterRole !== "owner") {
    return Response.json(
      { ok: false, error: "Only the owner can remove an owner" },
      { status: 403 },
    );
  }

  // Never remove the last owner.
  if (targetRole === "owner") {
    const owners = await orgService.countOwners(id);
    if (owners <= 1) {
      return Response.json(
        { ok: false, error: "An org must have at least one owner" },
        { status: 400 },
      );
    }
  }

  const removed = await orgService.removeMember(id, memberId);
  if (!removed) {
    return Response.json(
      { ok: false, error: "Member not found" },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
