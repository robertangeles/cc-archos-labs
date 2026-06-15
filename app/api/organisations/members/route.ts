import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import { listOrgMembers } from "@/lib/orgs/service";

export const runtime = "nodejs";

// GET /api/organisations/members — list the members of the CURRENT org for the
// card assignee picker. Any member. Returns userId, displayName, email, role.
export async function GET(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request);
    const members = await listOrgMembers(ctx.orgId);
    return Response.json({ ok: true, members });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
