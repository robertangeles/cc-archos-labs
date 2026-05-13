import { z } from "zod";
import { signSession } from "../../../../lib/auth";
import { verifyAdminPassword } from "../../../../lib/admin-password";
import { setSessionCookie } from "../../../../lib/auth-server";
import { rateLimit, clientIpFromRequest } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// Brute-force defense: cap attempts per IP. The throttle is shared with
// other rate-limited endpoints by IP, but uses a distinct namespace so a
// flood of contact-form submits doesn't lock out admin login.
const LOGIN_ATTEMPTS_PER_HOUR = 10;

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`admin-login:${ip}`, LOGIN_ATTEMPTS_PER_HOUR);
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

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid input." },
      { status: 400 },
    );
  }

  if (!(await verifyAdminPassword(parsed.data.password))) {
    // Generic message — don't reveal whether the password matched a known
    // value or whether the integration config is misconfigured. The real
    // failure mode (DB unreachable, wrong key, no migration) is in the logs.
    return Response.json(
      { ok: false, error: "Incorrect password." },
      { status: 401 },
    );
  }

  try {
    const token = await signSession();
    await setSessionCookie(token);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Admin login crash:", err);
    return Response.json(
      {
        ok: false,
        error: "We couldn't sign you in right now. Try again.",
      },
      { status: 500 },
    );
  }
}
