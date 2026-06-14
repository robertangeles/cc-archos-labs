import {
  requireOrgContext,
  orgAuthErrorResponse,
  setOrgCookie,
} from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

// POST /api/organisations/switch — change the active org. The user must already
// be a member of the target org; membership is re-verified server-side before
// the cookie is moved. Any authenticated user (acts on the user, not an org).
export async function POST(request: Request) {
  let auth;
  try {
    ({ auth } = await requireOrgContext(request, { mutation: true }));
  } catch (err) {
    const res = orgAuthErrorResponse(err);
    if (res) return res;
    throw err;
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

  const { orgId } = (body ?? {}) as { orgId?: unknown };
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    return Response.json(
      { ok: false, error: "An organisation id is required" },
      { status: 400 },
    );
  }

  const org = await orgService.getOrgWithMembers(orgId);
  const isMember = !!org && org.members.some((m) => m.userId === auth.user.id);
  if (!isMember) {
    return Response.json(
      { ok: false, error: "You are not a member of that organisation" },
      { status: 403 },
    );
  }

  await setOrgCookie(orgId);

  return Response.json({ ok: true });
}
