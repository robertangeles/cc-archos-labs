import { getCurrentUser } from "@/lib/auth/current-user";
import { setOrgCookie } from "@/lib/auth/org-context";
import * as orgService from "@/lib/orgs/service";

export const runtime = "nodejs";

// GET /api/organisations — list the orgs the current user belongs to.
// Any authenticated user. No org context required (acts on the user).
export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }

  const organisations = await orgService.listUserOrgs(auth.user.id);
  return Response.json({ ok: true, organisations });
}

// POST /api/organisations — create a new org owned by the current user, then
// make it the active org via the session cookie. Any authenticated user.
export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
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

  const { name, description } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
  };

  if (typeof name !== "string" || name.trim().length === 0) {
    return Response.json(
      { ok: false, error: "Organisation name is required" },
      { status: 400 },
    );
  }
  if (description !== undefined && typeof description !== "string") {
    return Response.json(
      { ok: false, error: "Description must be text" },
      { status: 400 },
    );
  }

  const org = await orgService.createOrg(auth.user.id, {
    name: name.trim(),
    description: typeof description === "string" ? description : null,
  });

  await setOrgCookie(org.id);

  return Response.json({ ok: true, organisation: org }, { status: 201 });
}
