import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { assessmentSession } from "../../../../lib/db/schema";
import { mintShareToken } from "../../../../lib/share-tokens";
import { getLeadFromCookies } from "../../../../lib/auth-server";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/diagnostic/share
//   body: { sessionId: string }
//   response: { ok: true, url: string, expiresAt: ISO, id: string }
//
// Mints a new share token for a report the requesting lead owns.
// Owner-only — the lead session cookie must match the session's lead.
// Rate-limited per IP to bound abuse if a cookie leaks.

const SHARES_PER_IP_PER_HOUR = 20;

const BodySchema = z.object({
  sessionId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Invalid session id",
    ),
});

export async function POST(request: Request) {
  const session = await getLeadFromCookies();
  if (!session) {
    return Response.json(
      { ok: false, error: "Sign in to share a report." },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`share-mint:${ip}`, SHARES_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many share links. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Owner check: the cookie's lead must own this session.
  const db = getDb();
  const rows = await db
    .select({ leadId: assessmentSession.leadId })
    .from(assessmentSession)
    .where(eq(assessmentSession.id, parsed.data.sessionId))
    .limit(1);

  if (rows.length === 0 || rows[0].leadId !== session.leadId) {
    // 404, not 403, so probing session ids doesn't leak which exist.
    return Response.json(
      { ok: false, error: "Report not found." },
      { status: 404 },
    );
  }

  try {
    const minted = await mintShareToken(parsed.data.sessionId);
    const origin = new URL(request.url).origin;
    const url = `${origin}/tools/ai-readiness/share/${encodeURIComponent(minted.rawToken)}`;
    return Response.json({
      ok: true,
      id: minted.id,
      url,
      expiresAt: minted.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Share mint failed:", err);
    return Response.json(
      { ok: false, error: "Could not create share link. Try again." },
      { status: 500 },
    );
  }
}
