import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../lib/db";
import { users } from "../../../../../../lib/db/schema";
import { changeRole } from "../../../../../../lib/auth/users";
import { clientIpFromRequest } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

// PATCH /api/admin/users/[id]/role
// Body: { role: 'admin' | 'member' }
//
// Auth: proxy.ts gates /api/admin/**. For the audit log's
// `changed_by_user_id`, we look up the seeded admin row by email='admin'
// — there's only one admin today (the OLD admin-password JWT pattern,
// which has no userId in its payload). When T10 ships the unified
// session model, switch this to getCurrentUser().

const BodySchema = z.object({
  role: z.enum(["admin", "member"]),
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
      { ok: false, error: "Invalid role" },
      { status: 400 },
    );
  }

  // Resolve actor. Until T10 unifies admin + member sessions, the
  // admin acts as the single seeded row.
  const db = getDb();
  const actorRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin"))
    .limit(1);
  const actorUserId = actorRows[0]?.id ?? id; // worst case, log self-action

  const result = await changeRole({
    actorUserId,
    targetUserId: id,
    newRole: parsed.data.role,
    ipAddress: clientIpFromRequest(request) || null,
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    const statusByError: Record<string, number> = {
      ERR_NOT_FOUND: 404,
      ERR_LAST_ADMIN: 409,
      ERR_NO_CHANGE: 409,
      ERR_INVALID_ROLE: 400,
    };
    const status = statusByError[result.error ?? ""] ?? 400;
    const message =
      result.error === "ERR_LAST_ADMIN"
        ? "Cannot demote the last active admin."
        : result.error === "ERR_NOT_FOUND"
          ? "User not found."
          : result.error === "ERR_NO_CHANGE"
            ? "User already has that role."
            : "Could not change role.";
    return Response.json({ ok: false, error: message }, { status });
  }

  return Response.json({ ok: true });
}
