import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../lib/db";
import { users } from "../../../../../../lib/db/schema";
import { setActive } from "../../../../../../lib/auth/users";
import { clientIpFromRequest } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

// PATCH /api/admin/users/[id]/active
// Body: { active: boolean }
//
// Auth: proxy.ts gates /api/admin/**. See sibling role/ route for the
// actor-resolution note (TODO: switch to getCurrentUser() in T10).

const BodySchema = z.object({
  active: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (typeof id !== "string" || id.length === 0) {
    return Response.json(
      { ok: false, error: "Invalid user id" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    );
  }

  const db = getDb();
  const actorRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin"))
    .limit(1);
  const actorUserId = actorRows[0]?.id ?? id;

  const result = await setActive({
    actorUserId,
    targetUserId: id,
    active: parsed.data.active,
    ipAddress: clientIpFromRequest(request) || null,
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    const statusByError: Record<string, number> = {
      ERR_NOT_FOUND: 404,
      ERR_LAST_ADMIN: 409,
      ERR_SELF_DEACTIVATE: 409,
      ERR_NO_CHANGE: 409,
    };
    const status = statusByError[result.error ?? ""] ?? 400;
    const message =
      result.error === "ERR_LAST_ADMIN"
        ? "Cannot deactivate the last active admin."
        : result.error === "ERR_SELF_DEACTIVATE"
          ? "Admins cannot deactivate themselves."
          : result.error === "ERR_NOT_FOUND"
            ? "User not found."
            : result.error === "ERR_NO_CHANGE"
              ? "User already in that state."
              : "Could not update user.";
    return Response.json({ ok: false, error: message }, { status });
  }

  return Response.json({ ok: true });
}
