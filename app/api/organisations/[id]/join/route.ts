import {
  requireOrgContext,
  orgAuthErrorResponse,
  setOrgCookie,
} from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

// POST /api/organisations/[id]/join — join an org by invite key for the current
// user. The [id] path segment is not trusted as the org id; membership is
// granted strictly by the {joinKey} in the body. Any authenticated user.
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

  const { joinKey } = (body ?? {}) as { joinKey?: unknown };
  if (typeof joinKey !== "string" || joinKey.trim().length === 0) {
    return Response.json(
      { ok: false, error: "An invite key is required" },
      { status: 400 },
    );
  }

  const result = await orgService.joinOrgByKey(auth.user.id, joinKey.trim());

  if (result.status === "not_found") {
    return Response.json(
      { ok: false, error: "That invite key is not valid" },
      { status: 404 },
    );
  }

  if (result.status === "already_member") {
    return Response.json({
      ok: true,
      status: "already_member",
      organisationId: result.orgId,
    });
  }

  // status === "joined" — make the newly joined org the active one.
  if (result.orgId) {
    await setOrgCookie(result.orgId);
  }
  return Response.json({
    ok: true,
    status: "joined",
    organisationId: result.orgId,
  });
}
