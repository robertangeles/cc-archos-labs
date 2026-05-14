import { z } from "zod";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { verifyAdminPassword } from "../../../../../lib/admin-password";
import {
  fingerprintSession,
  signRevealToken,
  REVEAL_COOKIE,
} from "../../../../../lib/admin-reveal-token";
import {
  rateLimit,
  clientIpFromRequest,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/admin/integrations/reveal-auth
//
// Step-up auth for plaintext-reveal of integration secrets. Admin
// supplies their password; we verify it (against the same DB-backed
// hash the login route uses); we issue a short-lived 'reveal' JWT
// cookie. The cookie ties to a specific admin session via fingerprint
// so a reveal token from one session can't be replayed by another.
//
// The reveal token cookie expires in 5 minutes server-side AND
// browser-side. After expiry the admin re-prompts.
//
// Failure modes:
//   - Wrong password → 401 (no leak about whether session was valid)
//   - Session missing → 401 (would be caught by proxy.ts too)
//   - Rate-limited → 429 (brute-force defence)

const PASSWORD_ATTEMPTS_PER_HOUR = 10;

const BodySchema = z.object({
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `admin-reveal-auth:${ip}`,
    PASSWORD_ATTEMPTS_PER_HOUR,
  );
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid input." },
      { status: 400 },
    );
  }

  // Need the raw admin session JWT to compute a fingerprint that ties
  // the reveal token to this specific session.
  const cookieStore = await cookies();
  const adminSessionJwt = cookieStore.get(SESSION_COOKIE)?.value;
  if (!adminSessionJwt) {
    return Response.json(
      { ok: false, error: "Not signed in." },
      { status: 401 },
    );
  }

  const ok = await verifyAdminPassword(parsed.data.password);
  if (!ok) {
    return Response.json(
      { ok: false, error: "Incorrect password." },
      { status: 401 },
    );
  }

  const fingerprint = await fingerprintSession(adminSessionJwt);
  const revealToken = await signRevealToken(fingerprint);

  cookieStore.set(REVEAL_COOKIE, revealToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 5 minutes — must match the JWT's exp claim or browser will
    // hold a cookie the server already considers expired.
    maxAge: 60 * 5,
  });

  return Response.json({ ok: true });
}
