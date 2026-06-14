import {
  requireOrgContext,
  orgAuthErrorResponse,
  type OrgRole,
} from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

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

// POST /api/organisations/[id]/regenerate-key — rotate the invite key. owner|admin.
export async function POST(
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
      { ok: false, error: "You do not have permission to regenerate the invite key" },
      { status: 403 },
    );
  }

  const joinKey = await orgService.regenerateJoinKey(id);

  return Response.json({ ok: true, joinKey });
}
