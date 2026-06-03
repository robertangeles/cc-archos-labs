import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionJwtFromCookies } from "@/lib/auth/cookies";
import { loadActiveSession, refreshSession, type LoadedSession } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getSessionFromCookies } from "@/lib/auth-server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function requireUser(): Promise<
  | { ok: true; session: LoadedSession }
  | { ok: false; response: NextResponse }
> {
  const jwt = await getSessionJwtFromCookies();
  if (jwt) {
    const session = await loadActiveSession(jwt.sessionId, jwt.tokenVersion);
    if (session) {
      if (!session.user.emailVerifiedAt) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Please verify your email before using this tool." },
            { status: 403 },
          ),
        };
      }
      refreshSession(jwt.sessionId).then((result) => {
        if (result) setSessionCookie(result.cookieValue);
      }).catch(() => {});
      return { ok: true, session };
    }
  }

  const adminSession = await getSessionFromCookies();
  if (adminSession) {
    const db = getDb();
    const [adminUser] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        tokenVersion: users.tokenVersion,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

    if (adminUser) {
      return {
        ok: true,
        session: {
          user: adminUser,
          session: {
            id: "admin-legacy",
            expiresAt: new Date(Date.now() + 86400000),
            lastSeenAt: new Date(),
            revokedAt: null,
          },
        },
      };
    }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    ),
  };
}
