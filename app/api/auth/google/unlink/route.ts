import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { oauthAccount, users } from "../../../../../lib/db/schema";
import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import { clientIpFromRequest } from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/google/unlink
// Authenticated. Removes the (provider='google', user_id=<current>)
// row from oauth_account. Future logins via Google will create a fresh
// link (or new account if the user is deleted) — the unlink is reversible
// in that sense.
//
// REFUSE the unlink if the user has no password_hash set — otherwise
// they'd lock themselves out (no password = can't sign in any other way
// once Google is unlinked). The /account UI gates this with a "set a
// password first" affordance; this is the defensive server-side check.

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof CsrfOriginError) {
      return Response.json({ ok: false, error: "csrf" }, { status: 403 });
    }
    throw err;
  }

  const session = await getCurrentUser();
  if (!session) {
    return Response.json(
      { ok: false, error: "Sign in to manage your sign-in methods." },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const userAgent = request.headers.get("user-agent");

  const db = getDb();

  // Lockout defense: if user has no password, they need Google to
  // sign in. Refuse the unlink. Tell them to set a password first.
  const userRow = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (userRow[0] && !userRow[0].passwordHash) {
    return Response.json(
      {
        ok: false,
        error:
          "Set a password before unlinking Google — otherwise you'd lock yourself out.",
      },
      { status: 400 },
    );
  }

  const deleted = await db
    .delete(oauthAccount)
    .where(
      and(
        eq(oauthAccount.userId, session.user.id),
        eq(oauthAccount.provider, "google"),
      ),
    )
    .returning({ id: oauthAccount.id });

  // 200 either way — unlinking a non-existent link is idempotent.
  // Only audit when we actually removed something.
  if (deleted.length > 0) {
    await logAuthEvent({
      userId: session.user.id,
      eventType: "oauth_unlinked",
      ipAddress: ip || null,
      userAgent,
      metadata: { provider: "google" },
    });
  }

  return Response.json({
    ok: true,
    unlinked: deleted.length > 0,
  });
}
